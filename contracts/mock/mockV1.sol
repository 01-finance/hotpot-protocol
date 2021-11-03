pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IFToken, IFluxApp} from "../interfaces/IFToken.sol";
import {IaeWETH} from "../interfaces/IaeWETH.sol";

/// @title Arbitrum extended WETH
contract mockV1 is IFToken {
    address public override underlying;
    mapping(address => uint256) public override borrowBalanceOf;

    constructor(address _underlying) public {
        underlying = _underlying;
    }

    function app() external view override returns (IFluxApp) {
        revert("app");
    }

    function borrow(uint256 amount) external override {
        borrowBalanceOf[msg.sender] += amount;
        IERC20(underlying).transfer(msg.sender, amount);
    }

    function repay(uint256 amount) external override {
        borrowBalanceOf[msg.sender] -= amount;
        IERC20(underlying).transferFrom(msg.sender, address(this), amount);
    }

    function repay() external payable override {
        IaeWETH(underlying).deposit{value: msg.value}();
    }

    function borrow(address to, uint256 amount) external override {
        borrowBalanceOf[msg.sender] += amount;
        IERC20(underlying).transfer(to, amount);
    }

    function borrow(
        address to,
        uint256 amount,
        bool giveWETH
    ) external override {
        borrowBalanceOf[msg.sender] += amount;
        if (giveWETH) {
            IERC20(underlying).transfer(to, amount);
        } else {
            IaeWETH(underlying).withdrawTo(to, amount);
        }
    }
}
