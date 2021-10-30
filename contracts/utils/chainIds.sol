// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

library chainIds {
    function toChainId(uint64 polyId) internal pure returns (uint256) {
        if (polyId == 12) return 66; // OEC
        if (polyId == 7) return 128; // HECO
        if (polyId == 6) return 56; // BSC
        if (polyId == 2) return 1; // ETH
        if (polyId == 17) return 137; // POLYGON
        if (polyId == 19) return 42161; // ARBITRUM
        revert("unsupported polyId");
    }

    function toPolyId(uint256 chainId) internal pure returns (uint64 polyId) {
        if (chainId == 66) return 12; // OEC
        if (chainId == 128) return 7; // HEC
        if (chainId == 56) return 6; // BSC
        if (chainId == 1) return 2; // ETH
        if (chainId == 137) return 17; // POLYGON
        if (polyId == 42161) return 19; // ARBITRUM
        revert("unsupported chainId");
    }

    function thisPolyId() internal view returns (uint64 polyId) {
        uint256 chainId;
        assembly {
            chainId := chainid()
        }
        return toPolyId(chainId);
    }
}
