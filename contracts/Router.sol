// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IGateway} from "./interfaces/IGateway.sol";
import {IPriceOracle} from "./interfaces/IPriceOracle.sol";

contract Router is Ownable, ReentrancyGuard, Pausable {
    using SafeMath for uint256;
    address public feeCollector;

    function setFeeCollector(address collector) external onlyOwner {
        require(collector != address(0), "emtpy address");
        feeCollector = collector;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function crossTransfer(
        IGateway gate,
        address to,
        uint256 amount,
        uint256 maxFluxFee
    ) external nonReentrant whenNotPaused {
        gate.crossTransferFrom(msg.sender, to, amount, maxFluxFee);
    }

    function crossTransfer(
        IGateway gate,
        address to,
        uint256 amount,
        uint256 maxFluxFee,
        bytes calldata data
    ) external nonReentrant whenNotPaused {
        gate.crossTransferFrom(msg.sender, to, amount, maxFluxFee, data);
    }

    function crossRebalance(
        IGateway gate,
        address to,
        uint256 amount,
        uint256 fluxAmount
    ) external nonReentrant whenNotPaused {
        gate.crossRebalanceFrom(msg.sender, to, amount, fluxAmount);
    }

    function extractFee(address) external whenNotPaused {
        require(msg.sender == feeCollector, "!feeCollector");
        payable(msg.sender).transfer(address(this).balance);
    }
}
