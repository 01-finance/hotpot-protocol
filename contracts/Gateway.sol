// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

import "@openzeppelin/contracts-ethereum-package/contracts/access/Ownable.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/Initializable.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/math/SignedSafeMath.sol";
import {ERC20UpgradeSafe} from "@openzeppelin/contracts-ethereum-package/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts-ethereum-package/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts-ethereum-package/contracts/token/ERC20/SafeERC20.sol";

import {IEthCrossChainManager} from "./interfaces/poly/IEthCrossChainManager.sol";
import {IConfig} from "./interfaces/IConfig.sol";
import {IGateway} from "./interfaces/IGateway.sol";
import {IVault} from "./interfaces/IVault.sol";
import {IExtCaller} from "./interfaces/IExtCaller.sol";

abstract contract CrossBase {
    function getEthCrossChainManager() internal view virtual returns (IEthCrossChainManager);

    modifier onlyManagerContract() {
        require(msg.sender == address(getEthCrossChainManager()), "only EthCrossChainManagerContract");
        _;
    }

    function crossTo(
        uint64 chainId,
        address to,
        bytes memory method,
        bytes memory data
    ) internal {
        IEthCrossChainManager ccm = getEthCrossChainManager();
        require(ccm.crossChain(chainId, addressToBytes(to), method, data), "crossChain fail!");
    }

    /* @notice      Convert bytes to address
     *  @param _bs   Source bytes: bytes length must be 20
     *  @return      Converted address from source bytes
     */
    function bytesToAddress(bytes memory _bs) internal pure returns (address addr) {
        require(_bs.length == 20, "bytes length does not match address");
        assembly {
            // for _bs, first word store _bs.length, second word store _bs.value
            // load 32 bytes from mem[_bs+20], convert it into Uint160, meaning we take last 20 bytes as addr (address).
            addr := mload(add(_bs, 0x14))
        }
    }

    /* @notice      Convert address to bytes
     *  @param _addr Address need to be converted
     *  @return      Converted bytes from address
     */
    function addressToBytes(address _addr) internal pure returns (bytes memory bs) {
        assembly {
            // Get a location of some free memory and store it in result as
            // Solidity does for memory variables.
            bs := mload(0x40)
            // Put 20 (address byte length) at the first word, the length of bytes for uint256 value
            mstore(bs, 0x14)
            // logical shift left _a by 12 bytes, change _a from right-aligned to left-aligned
            mstore(add(bs, 0x20), shl(96, _addr))
            // Update the free-memory pointer by padding our last write location to 32 bytes
            mstore(0x40, add(bs, 0x40))
        }
    }
}

contract Gateway is OwnableUpgradeSafe, CrossBase, IGateway {
    using SafeMath for uint256;
    using SignedSafeMath for int256;
    using SafeERC20 for IERC20;
    enum Relayer {
        POLY,
        HOTPOT
    }
    enum CrossStatus {
        NONE,
        PENDING,
        COMPLETED,
        REVERTED
    }
    enum CrossType {
        TRANSFER,
        TRANSFER_WITH_DATA
    }
    IConfig public override config;
    uint64 public override remotePolyId;
    address public remoteGateway;
    CrossStatus public bindStatus;
    IVault public override vault;
    IERC20 public token;
    uint256 public nextCrossId;
    uint256 public fee;
    uint256 public constant FEE_DENOM = 10000;
    mapping(uint256 => CrossStatus) public existedIds;
    uint8 public constant decimals = 18;
    bytes constant CROSS_METHOD = "onCrossTransfer";

    uint256 constant CROSS_TYPE_OFFSET = 256 - 64;

    struct PendingTransfer {
        uint256 crossId;
        address to;
        uint256 metaAmount;
        uint256 metaFee;
        int256 feeFlux;
    }
    bytes[] public pending;
    mapping(bytes32 => uint256) public crossConfirms;
    uint256 public constant CONFIRM_THRESHOLD = 2;

    modifier onlyRouter() {
        require(config.isRouter(msg.sender), "onlyRouter");
        _;
    }

    modifier onlyHotpoter() {
        require(config.isHotpoter(msg.sender), "onlyHotpoter");
        _;
    }

    function initialize(IConfig _config, IVault _vault) external initializer {
        OwnableUpgradeSafe.__Ownable_init();
        config = _config;
        vault = _vault;
        token = _vault.token();
        token.approve(address(vault), type(uint256).max);
        fee = 30;
    }

    function getEthCrossChainManager() internal view override returns (IEthCrossChainManager) {
        return config.getEthCrossChainManager();
    }

    /// @dev bind remote polyId and gateway contract
    function bindGateway(uint64 polyId, address gateway) external onlyOwner {
        remotePolyId = polyId;
        remoteGateway = gateway;
        bindStatus = CrossStatus.COMPLETED;
    }

    /// @dev set fee, denominator is 10000
    function setFee(uint256 _fee) external onlyOwner {
        fee = _fee;
    }

    /// @dev align token decimal to 18
    function nativeToMeta(uint256 amount) private view returns (uint256) {
        uint8 tokenDecimals = ERC20UpgradeSafe(address(token)).decimals();
        uint8 metaDecimals = decimals;
        require(tokenDecimals <= metaDecimals, "HotpotGate::unsupported decimals");
        return amount.mul(10**uint256(metaDecimals - tokenDecimals));
    }

    /// @dev align 18-decimal to token decimal
    function metaToNative(uint256 amount) private view returns (uint256) {
        uint8 tokenDecimals = ERC20UpgradeSafe(address(token)).decimals();
        uint8 metaDecimals = decimals;
        require(tokenDecimals <= metaDecimals, "HotpotGate::unsupported decimals");
        return amount.div(10**uint256(metaDecimals - tokenDecimals));
    }

    function countSetBits(uint256 bitmap) private pure returns (uint256) {
        uint256 count = 0;
        while (bitmap > 0) {
            bitmap &= (bitmap - 1);
            count++;
        }
        return count;
    }

    function crossConfirm(bytes memory crossData, Relayer role) private returns (bool) {
        bytes32 sig = keccak256(crossData);
        uint256 bitmap = crossConfirms[sig] | (1 << uint256(role));
        crossConfirms[sig] = bitmap;
        emit CrossConfirm(sig, uint256(role), bitmap);
        return countSetBits(bitmap) >= CONFIRM_THRESHOLD;
    }

    function _crossTransfer(
        address from,
        address to,
        uint256 amount,
        uint256 _fee,
        int256 _feeFlux // <0: rebalance >0: crossTransfer
    ) private {
        uint256 crossId = (uint256(CrossType.TRANSFER) << CROSS_TYPE_OFFSET) | nextCrossId++;
        uint256 metaFee = nativeToMeta(_fee);
        uint256 metaAmount = nativeToMeta(amount).sub(metaFee);
        bytes memory txData = abi.encode(crossId, to, metaAmount, metaFee, _feeFlux);
        CrossBase.crossTo(remotePolyId, remoteGateway, CROSS_METHOD, txData);
        (uint256 tokenPrice, uint256 fluxPrice) = config.feePrice(address(token));
        emit CrossTransfer(crossId, from, to, metaAmount, metaFee, _feeFlux, tokenPrice, fluxPrice);
    }

    function _crossTransferWithData(
        address from,
        address to,
        uint256 amount,
        uint256 _fee,
        int256 _feeFlux, // <0: rebalance >0: crossTransfer
        bytes memory data
    ) private {
        uint256 crossId = (uint256(CrossType.TRANSFER_WITH_DATA) << CROSS_TYPE_OFFSET) | nextCrossId++;
        uint256 metaFee = nativeToMeta(_fee);
        uint256 metaAmount = nativeToMeta(amount).sub(metaFee);
        bytes memory txData = abi.encode(crossId, to, metaAmount, metaFee, _feeFlux, from, data);

        CrossBase.crossTo(remotePolyId, remoteGateway, CROSS_METHOD, txData);

        (uint256 tokenPrice, uint256 fluxPrice) = config.feePrice(address(token));
        emit CrossTransferWithData(crossId, from, to, metaAmount, metaFee, _feeFlux, tokenPrice, fluxPrice, data);
    }

    /**
     * @notice crossRebalanceFrom rebalance the liquidity
     * @param from payment account
     * @param to account in target chain that receiving the token
     * @param amount token amount
     * @param fluxAmount flux amount
     */
    function crossRebalanceFrom(
        address from,
        address to,
        uint256 amount,
        uint256 fluxAmount
    ) external override onlyRouter {
        require(fluxAmount >= 0, "invalid flux amount");
        require(bindStatus == CrossStatus.COMPLETED, "bind not completed");
        require(config.isBalancer(from), "onlyBalancer");
        vault.depositFund(from, uint256(amount), fluxAmount);
        dealPending(pending.length);
        (int256 debt, int256 debtFlux) = vault.gateDebt(address(this));
        require(debt <= 0, "invalid amount");
        require(debtFlux <= 0, "invalid amount");
        _crossTransfer(from, to, amount, 0, -int256(fluxAmount));
    }

    /**
     * @notice crossTransferFrom cross transfer token and call target contract with data
     * @param from payment account
     * @param to account in target chain that receiving the token
     * @param amount token amount
     * @param maxFluxFee maximum available Flux fee
     * @param data custom data passed to target contract
     */
    function crossTransferFrom(
        address from,
        address to,
        uint256 amount,
        uint256 maxFluxFee,
        bytes calldata data
    ) external override onlyRouter {
        require(bindStatus == CrossStatus.COMPLETED, "bind not completed");
        uint256 _fee = amount.mul(fee).div(FEE_DENOM);
        uint256 _feeFlux;
        if (maxFluxFee > 0) {
            _feeFlux = config.feeFlux(address(token), _fee);
            _fee = 0;
            require(_feeFlux <= maxFluxFee, "exceed flux fee limit!");
        }
        vault.depositFund(from, amount, _feeFlux);
        require(_feeFlux < uint256(type(int256).max), "invalid fee");
        _crossTransferWithData(from, to, amount, _fee, int256(_feeFlux), data);
        dealPending(1);
    }

    /**
     * @notice crossTransferFrom cross transfer token
     * @param from payment account
     * @param to account in target chain that receiving the token
     * @param amount token amount
     * @param maxFluxFee maximum available Flux fee
     */
    function crossTransferFrom(
        address from,
        address to,
        uint256 amount,
        uint256 maxFluxFee
    ) external override onlyRouter {
        require(bindStatus == CrossStatus.COMPLETED, "bind not completed");
        uint256 _fee = amount.mul(fee).div(FEE_DENOM);
        uint256 _feeFlux;
        if (maxFluxFee > 0) {
            _feeFlux = config.feeFlux(address(token), _fee);
            _fee = 0;
            require(_feeFlux <= maxFluxFee, "exceed flux fee limit!");
        }
        vault.depositFund(from, amount, _feeFlux);
        require(_feeFlux < uint256(type(int256).max), "invalid fee");
        _crossTransfer(from, to, amount, _fee, int256(_feeFlux));
        dealPending(1);
    }

    function _onCrossTransfer(
        address to,
        uint256 metaAmount,
        uint256 metaFee,
        int256 _feeFlux
    ) internal returns (bool) {
        uint256 tokenAmount = metaToNative(metaAmount);
        uint256 tokenFee = metaToNative(metaFee);
        uint256 before = token.balanceOf(to);
        (bool success, ) = address(vault).call(abi.encodeWithSelector(vault.withdrawFund.selector, to, tokenAmount, tokenFee, _feeFlux));
        return success && token.balanceOf(to) == tokenAmount.add(before);
    }

    function _onCrossTransferWithData(
        address from,
        address to,
        uint256 metaAmount,
        uint256 metaFee,
        int256 _feeFlux,
        bytes memory data
    ) internal returns (bool) {
        bool success = _onCrossTransfer(to, metaAmount, metaFee, _feeFlux);
        if (success) {
            uint256 tokenAmount = metaToNative(metaAmount);
            address(config.caller()).call(abi.encodeWithSelector(IExtCaller.callExt.selector, to, remotePolyId, from, token, tokenAmount, data));
        }
        return success;
    }

    /// @dev virtual for unit test
    function _onCrossTransferExecute(bytes memory data) internal virtual returns (bool) {
        (, address to, uint256 metaAmount, uint256 metaFee, int256 _feeFlux) = abi.decode(data, (uint256, address, uint256, uint256, int256));
        return _onCrossTransfer(to, metaAmount, metaFee, _feeFlux);
    }

    /// @dev virtual for unit test
    function _onCrossTransferWithDataExecute(bytes memory data) internal virtual returns (bool) {
        (, address to, uint256 metaAmount, uint256 metaFee, int256 _feeFlux, address from, bytes memory extData) = abi.decode(
            data,
            (uint256, address, uint256, uint256, int256, address, bytes)
        );
        return _onCrossTransferWithData(from, to, metaAmount, metaFee, _feeFlux, extData);
    }

    /// @dev Do not call dealPending in onCrossTransferExecute!
    function onCrossTransferExecute(bytes memory data) private returns (CrossStatus) {
        uint256 crossId = abi.decode(data, (uint256));
        CrossStatus status = existedIds[crossId];
        if (status == CrossStatus.COMPLETED) return status;
        bool succeed = CrossType(crossId >> CROSS_TYPE_OFFSET) == CrossType.TRANSFER_WITH_DATA ? _onCrossTransferWithDataExecute(data) : _onCrossTransferExecute(data);
        CrossStatus newStatus = succeed ? CrossStatus.COMPLETED : CrossStatus.PENDING;
        if (status != newStatus) {
            // NONE->COMPLETED or NONE->PENDING
            existedIds[crossId] = newStatus;
            emit OnCrossTransferStatus(crossId, uint256(newStatus));
            if (newStatus == CrossStatus.PENDING) pending.push(data); // NONE->PENDING
        }
        return newStatus;
    }

    /// @notice onCrossTransfer is handler of crossTransfer event, called by poly ECCM contract
    function onCrossTransfer(
        bytes calldata data,
        bytes calldata fromAddress,
        uint64 fromPolyId
    ) public onlyManagerContract returns (bool) {
        address from = bytesToAddress(fromAddress);
        require(bindStatus == CrossStatus.COMPLETED, "bind not completed");
        require(remotePolyId == fromPolyId && remoteGateway == from, "invalid gateway");
        if (crossConfirm(data, Relayer.POLY)) onCrossTransferExecute(data);
        return true;
    }

    /// @notice multiple confirmation for cross data
    function onCrossTransferByHotpoter(
        bytes calldata data,
        address fromAddress,
        uint64 fromPolyId
    ) external onlyHotpoter returns (bool) {
        address from = fromAddress;
        require(bindStatus == CrossStatus.COMPLETED, "bind not completed");
        require(remotePolyId == fromPolyId && remoteGateway == from, "invalid gateway");
        if (crossConfirm(data, Relayer.HOTPOT)) onCrossTransferExecute(data);
        return true;
    }

    /// @notice length of pending order
    function pendingLength() external view returns (uint256) {
        return pending.length;
    }

    /// @notice deal pending order
    /// @dev Do not call this in onCrossTransferExecute!
    function dealPending(uint256 count) public {
        if (pending.length < count) count = pending.length;
        while (count-- > 0) {
            if (onCrossTransferExecute(pending[pending.length - 1]) == CrossStatus.COMPLETED) {
                pending.pop();
            } else {
                break;
            }
        }
    }
}
