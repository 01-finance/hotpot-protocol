// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

import "@openzeppelin/contracts-ethereum-package/contracts/access/Ownable.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/Initializable.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/math/Math.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/math/SignedSafeMath.sol";
import {ERC20UpgradeSafe} from "@openzeppelin/contracts-ethereum-package/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts-ethereum-package/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts-ethereum-package/contracts/token/ERC20/SafeERC20.sol";

import {IConfig} from "./Config.sol";
import {IVault} from "./interfaces/IVault.sol";
import {IFToken} from "./interfaces/IFToken.sol";
import {IaeWETH} from "./interfaces/IaeWETH.sol";

// deprecated
abstract contract RewardDistributor_deprecated {
    using SafeMath for uint256;
    using SignedSafeMath for int256;
    struct UserRewards {
        uint256 rewardFluxPerShare;
        uint256 rewardFlux;
    }
    uint256 public rewardFluxPerShareStored;
    mapping(address => UserRewards) public rewards;
    uint256 public reservedFeeFlux;
    uint256 public reservedFee;
    uint256 public constant RESERVED_POINT = 3000;
    uint256 public constant RESERVED_DENOM = 10000;
    uint256 private constant PER_SHARE_SACLE = 1e18;
}

contract Vault is OwnableUpgradeSafe, ERC20UpgradeSafe, IVault, RewardDistributor_deprecated {
    using SafeERC20 for IERC20;
    IERC20 public override token;
    IFToken public ftoken;
    IConfig public override config;
    struct GateDebt {
        int256 debt;
        int256 debtFlux;
    }
    mapping(address => GateDebt) public override gateDebt; // deprecated
    uint256 public totalToken; // deprecated
    address public constant WNative = 0x82aF49447D8a07e3bd95BD0d56f35241523fBab1;

    // totalToken == cash - sum(gateDebt) - reservedFee

    event WithdrawFund(address gateway, address to, uint256 amount, uint256 fee, int256 feeFlux);
    event DepositFund(address gateway, address from, uint256 amount, uint256 feeFlux);
    event Withdraw(address owner, address token, address to, uint256 amount);

    function initialize(
        IConfig _config,
        IERC20 _token,
        string calldata _name,
        string calldata _symbol
    ) external initializer {
        OwnableUpgradeSafe.__Ownable_init();
        ERC20UpgradeSafe.__ERC20_init(_name, _symbol);
        ERC20UpgradeSafe._setupDecimals(ERC20UpgradeSafe(address(_token)).decimals());
        config = _config;
        token = _token;
    }

    modifier onlyBound() {
        require(config.boundVault(msg.sender) == address(this), "Vault::onlyBound");
        _;
    }

    function setFToken(IFToken _ftoken) external onlyOwner {
        require(_ftoken.underlying() == address(token), "ftoken's underlying and token are not the same");
        ftoken = _ftoken;
    }

    function _borrowToken(uint256 amount) private {
        if (WNative == address(token)) {
            ftoken.borrow(address(this), amount, true);
        } else {
            ftoken.borrow(amount);
        }
    }

    function repayToken() external {
        IFToken _ftoken = ftoken;
        //if (address(_ftoken) == address(0)) return;

        uint256 debt = _ftoken.borrowBalanceOf(address(this));
        if (debt == 0) return;

        uint256 cash = token.balanceOf(address(this));
        uint256 repayAmount = Math.min(debt, cash);
        if (repayAmount > 0) {
            token.approve(address(_ftoken), repayAmount);
            _ftoken.repay(repayAmount);
        }
    }

    function withdrawFund(
        address to,
        uint256 amount,
        uint256 fee,
        int256 feeFlux
    ) external override onlyBound {
        uint256 cash = token.balanceOf(address(this));
        if (cash < amount) _borrowToken(amount - cash);
        if (WNative == address(token) && address(config.extCaller()) != to) {
            IaeWETH(WNative).withdrawTo(to, amount);
        } else {
            token.safeTransfer(to, amount);
        }
        if (feeFlux < 0) {
            config.FLUX().safeTransfer(to, uint256(-feeFlux));
        }
        emit WithdrawFund(msg.sender, to, amount, fee, feeFlux);
    }

    // called by gateway
    function depositFund(
        address from,
        uint256 amount,
        uint256 feeFlux
    ) external override onlyBound {
        if (WNative == address(token) && address(this).balance >= amount) {
            IaeWETH(WNative).deposit{value: address(this).balance}();
        } else {
            token.safeTransferFrom(from, address(this), amount);
        }
        if (feeFlux > 0) {
            config.FLUX().safeTransferFrom(from, address(this), feeFlux);
        }
        emit DepositFund(msg.sender, from, amount, feeFlux);
        //repayToken();
    }

    receive() external payable override {}
}
