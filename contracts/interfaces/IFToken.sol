// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

interface IFluxApp {
    function getBorrowLimit(address mkt, address acct) external view returns (uint256 limit, uint256 cash);
}

interface IFToken {
    function app() external view returns (IFluxApp);

    function underlying() external view returns (address);

    function borrow(uint256 amount) external;

    function borrowBalanceOf(address acct) external view returns (uint256);

    function repay(uint256 amount) external;

    function repay() external payable;

    function borrow(address to, uint256 amount) external;

    function borrow(
        address to,
        uint256 amount,
        bool giveWETH
    ) external;
}
