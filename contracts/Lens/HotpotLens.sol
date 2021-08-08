// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "../Vault.sol";
import "../Gateway.sol";
import {Router} from "../Router.sol";
import "../Config.sol";
import {IFluxApp, IFToken} from "../interfaces/IFToken.sol";

contract HotpotLens {
    struct VaultMeta {
        address token;
        uint256 totalShares;
        uint256 cash;
        uint256 borrowLimit;
        uint256 totalToken;
        uint256 tokenPrice;
        uint256 fluxPrice;
        uint256 userShares;
        uint256 userFluxRewards;
        uint256 tokenBalance;
        uint256 nativeBalance;
        uint256 tokenAllowance;
        uint256 reservedFee;
        uint256 reservedFeeFlux;
    }

    function getBorrowLimit(Vault vault) private view returns (uint256) {
        IFToken ftoken = IFToken(vault.ftoken());
        if (address(ftoken) == address(0)) return 0;
        (uint256 limit, uint256 cash) = ftoken.app().getBorrowLimit(address(ftoken), address(vault));
        return limit < cash ? limit : cash;
    }

    function getVaultMeta(Vault vault, address account) public view returns (VaultMeta memory) {
        IERC20 token = vault.token();
        IConfig config = vault.config();
        //IERC20 flux = config.FLUX();
        (uint256 tokenPrice, uint256 fluxPrice) = config.feePrice(address(token));
        return
            VaultMeta({
                token: address(token),
                totalShares: vault.totalSupply(),
                cash: token.balanceOf(address(vault)),
                borrowLimit: getBorrowLimit(vault),
                totalToken: vault.totalToken(),
                tokenPrice: tokenPrice,
                fluxPrice: fluxPrice,
                userShares: vault.balanceOf(account),
                userFluxRewards: vault.pendingReward(account),
                tokenBalance: token.balanceOf(account),
                nativeBalance: account.balance,
                tokenAllowance: token.allowance(account, address(vault)),
                reservedFee: vault.reservedFee(),
                reservedFeeFlux: vault.reservedFeeFlux()
            });
    }

    function getAllVaultsMeta(Vault[] calldata vaults, address account) external view returns (VaultMeta[] memory) {
        VaultMeta[] memory metas = new VaultMeta[](vaults.length);
        for (uint256 i = 0; i < vaults.length; i++) {
            metas[i] = getVaultMeta(vaults[i], account);
        }
        return metas;
    }

    struct TempVars {
        IERC20 token;
        IVault vault;
        IConfig config;
        Router router;
    }

    struct GatewayMeta {
        address token;
        uint64 remotePolyId;
        address remoteGateway;
        uint256 fee;
        uint256 fluxPoint;
        address vault;
        uint256 pendingLength;
        int256 balance;
        uint256 vaultCash;
        uint256 vaultBorrowLimit;
        uint256 tokenPrice;
        uint256 fluxPrice;
        uint256 feeNative;
        uint256 nativePrice;
        uint256 tokenBalance;
        uint256 fluxBalance;
        uint256 nativeBalance;
        uint256 tokenAllowance;
        uint256 fluxAllowance;
        uint256 bindStatus;
    }

    function getGatewayMeta(Gateway gateway, address account) public view returns (GatewayMeta memory) {
        TempVars memory temps = TempVars({token: gateway.token(), vault: gateway.vault(), config: gateway.config(), router: Router(0)});
        temps.router = Router(uint160(Config(address(temps.config)).router()));
        uint64 remotePolyId = gateway.remotePolyId();
        uint256 feeNative = temps.router.getFeeNative(remotePolyId);
        address nativeId = temps.router.wnative();
        IPriceOracle oracle = temps.router.oracle();
        uint256 nativePrice = oracle.getPriceMan(nativeId);
        IERC20 flux = temps.config.FLUX();
        (uint256 tokenPrice, uint256 fluxPrice) = temps.config.feePrice(address(temps.token));
        (int256 debt, ) = temps.vault.gateDebt(address(gateway));
        return
            GatewayMeta({
                token: address(temps.token),
                remotePolyId: remotePolyId,
                remoteGateway: gateway.remoteGateway(),
                fee: gateway.fee(),
                fluxPoint: 8000,
                vault: address(temps.vault),
                pendingLength: gateway.pendingLength(),
                balance: debt,
                vaultCash: temps.token.balanceOf(address(temps.vault)),
                vaultBorrowLimit: getBorrowLimit(Vault(address(temps.vault))),
                tokenPrice: tokenPrice,
                fluxPrice: fluxPrice,
                feeNative: feeNative,
                nativePrice: nativePrice,
                tokenAllowance: temps.token.allowance(account, address(temps.vault)),
                fluxAllowance: flux.allowance(account, address(temps.vault)),
                tokenBalance: temps.token.balanceOf(account),
                fluxBalance: flux.balanceOf(account),
                nativeBalance: account.balance,
                bindStatus: uint256(gateway.bindStatus())
            });
    }

    function getAllGatewaysMeta(Gateway[] calldata gateways, address account) external view returns (GatewayMeta[] memory) {
        GatewayMeta[] memory metas = new GatewayMeta[](gateways.length);
        for (uint256 i = 0; i < gateways.length; i++) {
            metas[i] = getGatewayMeta(gateways[i], account);
        }
        return metas;
    }
}
