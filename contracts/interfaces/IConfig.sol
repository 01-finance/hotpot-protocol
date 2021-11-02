// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

import {IERC20} from "@openzeppelin/contracts-ethereum-package/contracts/token/ERC20/IERC20.sol";

import {IEthCrossChainManager} from "./poly/IEthCrossChainManager.sol";
import {IExtCaller} from "./IExtCaller.sol";

interface IConfig {
    function FLUX() external view returns (IERC20);

    function boundVault(address) external view returns (address);

    function getEthCrossChainManager() external view returns (IEthCrossChainManager);

    function feeFlux(uint64 toPolyId) external view returns (uint256);

    function feeToken(uint64 toPolyId, address token) external view returns (uint256);

    function isCompromiser(address compromiser) external view returns (bool);

    function isBalancer(address balancer) external view returns (bool);

    function isHotpoter(address hotpoter) external view returns (bool);

    function isRouter(address) external view returns (bool);

    function feePrice(address token) external view returns (uint256, uint256);

    function extCaller() external view returns (IExtCaller);
}
