// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

import {IConfig} from "./IConfig.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/token/ERC20/IERC20.sol";

interface IVault {
    function token() external view returns (IERC20);

    function withdrawFund(
        address to,
        uint256 amount,
        uint256 fee,
        int256 feeFlux
    ) external;

    function depositFund(
        address from,
        uint256 amount,
        uint256 feeFlux
    ) external;

    function gateDebt(address) external view returns (int256, int256);

    function config() external view returns (IConfig);

    receive() external payable;
}
