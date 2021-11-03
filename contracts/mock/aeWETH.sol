// SPDX-License-Identifier: Apache-2.0

/*
 * Copyright 2020, Offchain Labs, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IaeWETH} from "../interfaces/IaeWETH.sol";

/// @title Arbitrum extended WETH
contract aeWETH is IaeWETH, ERC20("aeWETH", "aeWETH") {
    function deposit() external payable override {
        depositTo(msg.sender);
    }

    function withdraw(uint256 amount) external override {
        withdrawTo(msg.sender, amount);
    }

    function depositTo(address account) public payable override {
        ERC20._mint(account, msg.value);
    }

    function withdrawTo(address account, uint256 amount) public override {
        ERC20._burn(msg.sender, amount);
        (bool success, ) = account.call{value: amount}("");
        require(success, "FAIL_TRANSFER");
    }

    receive() external payable {
        depositTo(msg.sender);
    }
}
