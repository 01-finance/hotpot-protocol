// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

import "../interfaces/IHotpotCallee.sol";
import "../interfaces/IExtCaller.sol";
import {IConfig} from "../interfaces/IConfig.sol";

library chainIds {
    function toChainId(uint64 polyId) internal pure returns (uint256) {
        if (polyId == 200) return 65; // OEC
        if (polyId == 7) return 256; // HECO
        if (polyId == 79) return 97; // BSC
        if (polyId == 2) return 3; // ETH
        if (polyId == 31337 || polyId == 1337) return polyId; // local
        revert("unsupported polyId");
    }

    function toPolyId(uint256 chainId) internal pure returns (uint64) {
        if (chainId == 65) return 200; // OEC
        if (chainId == 256) return 7; // HECO
        if (chainId == 97) return 79; // BSC
        if (chainId == 3) return 2; // ETH
        if (chainId == 31337 || chainId == 1337) return uint64(chainId); // local
        revert("unsupported chainId");
    }

    function thisPolyId() internal view returns (uint64 polyId) {
        uint256 chainId;
        assembly {
            chainId := chainid()
        }
        require(chainId == 1337 || chainId == 31337, "only local env");
        return toPolyId(chainId);
    }
}

contract ExtCallerTestnet is IExtCaller {
    IConfig public config;
    using chainIds for uint64;

    modifier onlyGateway() {
        require(address(0) != config.boundVault(msg.sender), "onlyGateway");
        _;
    }

    constructor(IConfig _config) public {
        config = _config;
    }

    function callExt(
        IHotpotCallee toContract,
        uint64 fromPolyId,
        address from,
        address token,
        uint256 amount,
        bytes calldata data
    ) external virtual override onlyGateway {
        uint64 fromChainId = uint64(fromPolyId.toChainId());
        toContract.hotpotCallback(fromChainId, from, token, amount, data);
    }
}

contract ExtCallerLocal is ExtCallerTestnet {
    constructor(IConfig _config) public ExtCallerTestnet(_config) {}

    function callExt(
        IHotpotCallee toContract,
        uint64 fromPolyId,
        address from,
        address token,
        uint256 amount,
        bytes calldata data
    ) external override onlyGateway {
        uint64 fromChainId = fromPolyId;
        toContract.hotpotCallback(fromChainId, from, token, amount, data);
    }
}
