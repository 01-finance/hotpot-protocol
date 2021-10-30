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
import {IHotpotCallee} from "./interfaces/IHotpotCallee.sol";
import {chainIds} from "./utils/chainIds.sol";
// import {chainIds} from "./mock/ExtCallerTestnet.sol"; // only for test

import "hardhat/console.sol";

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
enum CrossType {
    TRANSFER,
    TRANSFER_WITH_DATA,
    TRANSFER_V2,
    TRANSFER_WITH_DATA_V2
}

library CrossDataEncoder {
    using CrossDataEncoder for bytes;

    uint256 private constant TIMESTAMP_OFFSET = 28 * 8;
    uint256 private constant TIMESTAMP_MASK = 0xFFFFFFFF << TIMESTAMP_OFFSET;

    uint256 private constant CHECKCODE_OFFSET = 20 * 8;
    uint256 private constant CHECKCODE_MASK = 0xFFFFFFFF << CHECKCODE_OFFSET;

    uint256 constant CROSS_TYPE_OFFSET = 24 * 8;
    uint256 constant CROSS_TYPE_MASK = 0xFFFFFFFF << CROSS_TYPE_OFFSET;

    function typedCrossId(uint256 corssId, CrossType crossTyp) internal pure returns (uint256) {
        return corssId | ((uint256(crossTyp) << CROSS_TYPE_OFFSET) & CROSS_TYPE_MASK);
    }

    function encode(
        uint256 crossId,
        address to,
        uint256 metaAmount,
        uint256 metaFee,
        int256 _feeFlux
    ) internal view returns (bytes memory) {
        crossId = typedCrossId(crossId, CrossType.TRANSFER_V2);
        return abi.encode(crossId, to, metaAmount, metaFee, _feeFlux).seal();
    }

    function encode(
        uint256 crossId,
        address to,
        uint256 metaAmount,
        uint256 metaFee,
        int256 _feeFlux,
        address from,
        bytes memory data
    ) internal view returns (bytes memory) {
        crossId = typedCrossId(crossId, CrossType.TRANSFER_WITH_DATA_V2);
        return abi.encode(crossId, to, metaAmount, metaFee, _feeFlux, from, data).seal();
    }

    function decode(bytes memory data)
        internal
        pure
        returns (
            uint256,
            address,
            uint256,
            uint256,
            int256
        )
    {
        return abi.decode(data, (uint256, address, uint256, uint256, int256));
    }

    function decodeWithData(bytes memory data)
        internal
        pure
        returns (
            uint256,
            address,
            uint256,
            uint256,
            int256,
            address,
            bytes memory
        )
    {
        return abi.decode(data, (uint256, address, uint256, uint256, int256, address, bytes));
    }

    function setCrossId(bytes memory data, uint256 crossId) internal pure {
        assembly {
            mstore(add(data, 0x20), crossId)
        }
    }

    function getCrossId(bytes memory data) internal pure returns (uint256 crossId) {
        assembly {
            crossId := mload(add(data, 0x20))
        }
    }

    function getCrossType(bytes memory data) internal pure returns (CrossType) {
        uint256 crossId = data.getCrossId();
        return CrossType((crossId & CROSS_TYPE_MASK) >> CROSS_TYPE_OFFSET);
    }

    function checkCode(
        bytes memory data,
        address fromContract,
        uint256 fromPolyId
    ) internal pure returns (uint256) {
        return uint256(keccak256(abi.encodePacked(data, fromContract, fromPolyId))) & CHECKCODE_MASK;
    }

    function seal(bytes memory data) internal view returns (bytes memory) {
        uint256 thisPolyId = chainIds.thisPolyId();
        uint256 crossId = data.getCrossId();
        crossId |= (block.timestamp << TIMESTAMP_OFFSET) & TIMESTAMP_MASK;
        data.setCrossId(crossId);
        uint256 _checkCode = data.checkCode(address(this), thisPolyId);
        data.setCrossId(crossId | _checkCode);
        return data;
    }

    function verifySeal(
        bytes memory data,
        address fromContract,
        uint256 fromPolyId
    ) internal view {
        uint256 crossId = data.getCrossId();
        CrossType typ = CrossType((crossId & CROSS_TYPE_MASK) >> CROSS_TYPE_OFFSET);
        if (isV1(typ)) return; // skip checkcode in v1
        //fromPolyId = 31337; // only hotpot testcase
        uint256 timestampMsg = (crossId & TIMESTAMP_MASK) >> TIMESTAMP_OFFSET;
        uint256 checkcodeMsg = (crossId & CHECKCODE_MASK);
        data.setCrossId(crossId & (~CHECKCODE_MASK));
        uint256 _checkCode = data.checkCode(fromContract, fromPolyId);
        require(checkcodeMsg == _checkCode, "wrong checkcode");
        require(block.timestamp - timestampMsg > 2 minutes, "atleast delay 2 minutes");
        data.setCrossId(crossId); // backup
    }

    /// @dev v1 means it should use ploy network
    function isV1(CrossType typ) internal pure returns (bool) {
        return typ < CrossType.TRANSFER_V2;
    }

    function isV1(bytes memory data) internal pure returns (bool) {
        return isV1(data.getCrossType());
    }

    function hasExtraData(bytes memory data) internal pure returns (bool) {
        CrossType crossType = data.getCrossType();
        return crossType == CrossType.TRANSFER_WITH_DATA || crossType == CrossType.TRANSFER_WITH_DATA_V2;
    }
}

contract Gateway is OwnableUpgradeSafe, CrossBase, IGateway {
    using CrossDataEncoder for bytes;
    using SafeMath for uint256;
    using SignedSafeMath for int256;
    using SafeERC20 for IERC20;
    enum Relayer {
        POLY,
        HOTPOT
    }
    enum CrossStatus {
        NONE,
        PENDING, // deprecated
        COMPLETED,
        REVERTED // deprecated
    }
    IConfig public override config;
    uint64 public override remotePolyId;
    address public remoteGateway;
    CrossStatus public bindStatus;
    IVault public override vault;
    IERC20 public token;
    uint256 public nextCrossId;
    uint256 public fee;
    mapping(uint256 => CrossStatus) private existedIds_deprecated; // deprecated, merged to crossConfirms
    bytes[] private pending_deprecated; // deprecated
    mapping(bytes32 => uint256) public crossConfirms;

    uint8 public constant decimals = 18;
    bytes constant CROSS_METHOD = "onCrossTransfer";
    uint256 public constant CONFIRM_THRESHOLD = 2;
    uint256 public constant CONFIRM_THRESHOLD_V2 = 1;
    uint256 public constant FEE_DENOM = 10000;
    uint256 private constant EXECUTED_FLAG = 1 << 255; // 0x8000000000000000000000000000000000000000000000000000000000000000L
    uint256 private constant BITMAP_MASK = EXECUTED_FLAG - 1; // 0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffL

    modifier onlyEOA() {
        require(msg.sender == tx.origin, "onlyEOA");
        _;
    }

    modifier onlyRouter() {
        require(config.isRouter(msg.sender), "onlyRouter");
        _;
    }

    modifier onlyHotpoter() {
        require(config.isHotpoter(msg.sender), "onlyHotpoter");
        _;
    }
    modifier onlyCompromiser() {
        require(config.isCompromiser(msg.sender), "onlyCompromiser");
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
        bitmap &= BITMAP_MASK;
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
        return confirmed(bitmap, crossData);
    }

    function confirmed(uint256 bitmap, bytes memory data) private pure returns (bool) {
        uint256 threshold = data.isV1() ? CONFIRM_THRESHOLD : CONFIRM_THRESHOLD_V2;
        return countSetBits(bitmap) >= threshold;
    }

    /// @dev check 'crossData' was confirmed and haven't been executed
    function executeGuard(bytes memory crossData) private {
        bytes32 sig = keccak256(crossData);
        uint256 bitmap = crossConfirms[sig];
        require(confirmed(bitmap, crossData), "onlyConfirmed");
        require(bitmap & EXECUTED_FLAG == 0, "executed");
        crossConfirms[sig] = bitmap | EXECUTED_FLAG;
        emit OnCrossTransfer(sig);
    }

    function _crossTransfer(
        address from,
        address to,
        uint256 amount,
        uint256 _fee,
        int256 _feeFlux // <0: rebalance >0: crossTransfer
    ) private {
        uint256 metaFee = nativeToMeta(_fee);
        uint256 metaAmount = nativeToMeta(amount);
        bytes memory txData = CrossDataEncoder.encode(nextCrossId++, to, metaAmount, metaFee, _feeFlux);
        if (txData.isV1()) {
            CrossBase.crossTo(remotePolyId, remoteGateway, CROSS_METHOD, txData);
        }
        (uint256 tokenPrice, uint256 fluxPrice) = config.feePrice(address(token));
        emit CrossTransfer(txData.getCrossId(), from, to, metaAmount, metaFee, _feeFlux, tokenPrice, fluxPrice);
    }

    function _crossTransferWithData(
        address from,
        address to,
        uint256 amount,
        uint256 _fee,
        int256 _feeFlux, // <0: rebalance >0: crossTransfer
        bytes memory data
    ) private {
        uint256 metaFee = nativeToMeta(_fee);
        uint256 metaAmount = nativeToMeta(amount);
        bytes memory txData = CrossDataEncoder.encode(nextCrossId++, to, metaAmount, metaFee, _feeFlux, from, data);
        if (txData.isV1()) {
            CrossBase.crossTo(remotePolyId, remoteGateway, CROSS_METHOD, txData);
        }

        (uint256 tokenPrice, uint256 fluxPrice) = config.feePrice(address(token));
        emit CrossTransferWithData(txData.getCrossId(), from, to, metaAmount, metaFee, _feeFlux, tokenPrice, fluxPrice, data);
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
        require(bindStatus == CrossStatus.COMPLETED, "bind not completed");
        require(config.isBalancer(from), "onlyBalancer");
        vault.depositFund(from, uint256(amount), fluxAmount);
        //_dealPending(pending.length);
        /*
        (int256 debt, int256 debtFlux) = vault.gateDebt(address(this));
        require(amount == 0 || debt <= 0, "invalid amount");
        require(fluxAmount == 0 || debtFlux <= 0, "invalid amount");
        */
        _crossTransfer(from, to, amount, 0, -int256(fluxAmount));
    }

    /// @dev get token from vault to rebalance via off-chain
    function rebalanceWithdraw(uint256 amount) external onlyCompromiser {
        require(token.balanceOf(address(vault)) >= amount, "cash insufficient");
        vault.withdrawFund(msg.sender, amount, 0, 0);
    }

    /// @dev deposit token to vault to complete off-chain rebalance
    function rebalanceDeposit(uint256 amount) external {
        vault.depositFund(msg.sender, amount, 0);
    }

    function _crossTransferFrom(
        address from,
        address to,
        uint256 amount,
        uint256 maxFluxFee,
        bool withData,
        bytes memory data
    ) private {
        require(bindStatus == CrossStatus.COMPLETED, "bind not completed");
        uint256 _fee;
        uint256 _feeFlux;
        if (amount > 0) {
            _fee = amount.mul(fee).div(FEE_DENOM);
            if (maxFluxFee > 0) {
                _feeFlux = config.feeFlux(address(token), _fee);
                _fee = 0;
                require(_feeFlux <= maxFluxFee, "exceed flux fee limit!");
            }
            vault.depositFund(from, amount, _feeFlux); // amount includes fee
            require(_feeFlux < uint256(type(int256).max), "invalid fee");
        }
        if (withData) _crossTransferWithData(from, to, amount.sub(_fee), _fee, int256(_feeFlux), data);
        else _crossTransfer(from, to, amount.sub(_fee), _fee, int256(_feeFlux));
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
        _crossTransferFrom(from, to, amount, maxFluxFee, true, data);
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
        _crossTransferFrom(from, to, amount, maxFluxFee, false, hex"");
    }

    function _onCrossTransfer(
        address to,
        uint256 metaAmount,
        uint256 metaFee,
        int256 _feeFlux
    ) internal {
        if (metaAmount == 0 && _feeFlux == 0) return;
        uint256 tokenAmount = metaToNative(metaAmount);
        uint256 tokenFee = metaToNative(metaFee);
        vault.withdrawFund(to, tokenAmount, tokenFee, _feeFlux);
    }

    function _onCrossTransferWithData(
        address from,
        address to,
        uint256 metaAmount,
        uint256 metaFee,
        int256 _feeFlux,
        bytes memory data
    ) internal {
        _onCrossTransfer(to, metaAmount, metaFee, _feeFlux);
        uint256 tokenAmount = metaToNative(metaAmount);
        config.extCaller().callExt(IHotpotCallee(to), remotePolyId, from, address(token), tokenAmount, data);
    }

    /// @dev virtual for unit test
    function _onCrossTransferExecute(bytes memory data) internal virtual {
        (, address to, uint256 metaAmount, uint256 metaFee, int256 _feeFlux) = abi.decode(data, (uint256, address, uint256, uint256, int256));
        _onCrossTransfer(to, metaAmount, metaFee, _feeFlux);
    }

    /// @dev virtual for unit test
    function _onCrossTransferWithDataExecute(bytes memory data) internal virtual {
        (, address to, uint256 metaAmount, uint256 metaFee, int256 _feeFlux, address from, bytes memory extData) = abi.decode(
            data,
            (uint256, address, uint256, uint256, int256, address, bytes)
        );
        _onCrossTransferWithData(from, to, metaAmount, metaFee, _feeFlux, extData);
    }

    function onCrossTransferExecute(bytes calldata data) external {
        executeGuard(data); // safety check, if data is illegal, tx will revert
        data.hasExtraData() ? _onCrossTransferWithDataExecute(data) : _onCrossTransferExecute(data);
    }

    function _onCrossTransferByRole(
        bytes memory data,
        address fromAddress,
        uint64 fromPolyId,
        Relayer role
    ) private {
        require(bindStatus == CrossStatus.COMPLETED, "bind not completed");
        require(remotePolyId == fromPolyId && remoteGateway == fromAddress, "invalid gateway");
        if (crossConfirm(data, role)) {
            // if onCrossTransferExecute failed, it will be called by EOA account again.
            //this.onCrossTransferExecute(data);
            address(this).call(abi.encodeWithSelector(this.onCrossTransferExecute.selector, data));
        }
    }

    /// @notice onCrossTransfer is handler of crossTransfer event, called by poly ECCM contract
    function onCrossTransfer(
        bytes calldata data,
        bytes calldata fromAddress,
        uint64 fromPolyId
    ) external onlyManagerContract returns (bool) {
        require(data.isV1(), "only V1 support poly network");
        address from = bytesToAddress(fromAddress);
        _onCrossTransferByRole(data, from, fromPolyId, Relayer.POLY);
        return true;
    }

    /// @notice multiple confirmation for cross data
    function onCrossTransferByHotpoter(
        bytes calldata data,
        address fromAddress,
        uint64 fromPolyId
    ) external onlyHotpoter {
        bytes memory memData = data;
        memData.verifySeal(fromAddress, fromPolyId);
        _onCrossTransferByRole(memData, fromAddress, fromPolyId, Relayer.HOTPOT);
    }
}
