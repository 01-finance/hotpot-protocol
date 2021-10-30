const { ethers } = require('hardhat');

Number.prototype.toAddress = function () {
    const hexStr = ethers.BigNumber.from(Number(this)).toHexString().slice(2);
    const pad = 40 - hexStr.length;
    return `0x${'0'.repeat(pad)}${hexStr}`;
}
String.prototype.toAddress = Number.prototype.toAddress;

const bn = ethers.BigNumber.from

async function deployProxy(Contract, inputs) {
    const factory = (await ethers.getContractFactory(
        Contract,
        (await ethers.getSigners())[0]
    ));
    const proxyed = await upgrades.deployProxy(factory, inputs);
    await proxyed.deployed();
    console.log(`>> DeployedProxy ${Contract} at ${proxyed.address}`);
    return proxyed;
}

async function deploy(Contract, inputs = []) {
    const factory = (await ethers.getContractFactory(
        Contract,
        (await ethers.getSigners())[0]
    ));
    const contract = await factory.deploy(...inputs);
    await contract.deployed();
    console.log(`>> Deployed ${Contract} at ${contract.address}`);
    return contract;
}

const PRICE = price => ethers.utils.parseUnits(String(price), 18);

class Hotpot {
    static polyMock;
    static oracle;
    static chains = [];
    static accounts;
    static srcAccount;
    static destAccount;
    static lpAccount;

    constructor() {
        this.polyId = Hotpot.chains.length + 1;
    }

    async deploy() {
        this.oracle = await deploy('SimplePriceOracle');
        this.access = await deployProxy('Access', []);
        this.router = await deploy('Router', [this.oracle.address, this.polyId.toAddress()]);
        this.flux = await deploy('ERC20Mock', ['Flux Mock', 'Flux', 18]);
        this.config = await deployProxy('Config', [Hotpot.polyMock.address, this.flux.address, this.access.address, this.oracle.address, this.router.address]);
        this.tokens = {};
        this.vaults = {};
        this.gateways = {};
        this.lens = await deploy('HotpotLens', []);
        this.caller = await deploy('ExtCallerLocal', [this.config.address]);
        await this.config.setCaller(this.caller.address);
        this.callee = await deploy('Callee', [this.config.address]);
        await this.oracle.setPrice(this.flux.address, PRICE(0.5));
        await this.access.setBalancer(Hotpot.srcAccount.address, true);
        return this.access.setHotpoter(Hotpot.srcAccount.address, true);
    }

    async init(price, gas, gasPrice) {
        this.nativePrice = price;
        this.gas = gas;
        this.gasPrice = gasPrice;
        return this.oracle.setPrice(this.polyId.toAddress(), price);
    }

    async setRemoteGas(destChain) {
        await this.oracle.setPrice(destChain.polyId.toAddress(), destChain.nativePrice);
        return this.router.setGas([destChain.polyId], [destChain.gas], [destChain.gasPrice]);
    }

    async addToken(symbol, decimals, price) {
        if (this.tokens[symbol]) throw "token existed";
        const token = await deploy('ERC20Mock', [symbol, symbol, decimals]);
        this.tokens[symbol] = token;
        await this.addVault(symbol);
        if (price) await this.oracle.setPrice(token.address, PRICE(price));
        return token;
    }

    async addVault(symbol) {
        const token = this.tokens[symbol];
        const args = [
            this.config.address,
            token.address,
            `Hotpot Vault ${symbol.toUpperCase()}`,
            `hot${symbol.toUpperCase()}`
        ]
        const vault = await deployProxy('Vault', args, ['Vaults', symbol]);
        this.vaults[symbol] = vault;
        return vault;
    }

    async addGateway(remotePolyId, symbol) {
        const vault = this.vaults[symbol];
        const args = [
            this.config.address,
            vault.address
        ];
        if (!this.gateways[remotePolyId]) this.gateways[remotePolyId] = {}
        const gateway = await deployProxy('GatewayMock', args);
        await this.config.bindVault(vault.address, gateway.address);
        this.gateways[remotePolyId][symbol] = gateway;
        return gateway;
    }

    async bindGateway(symbol, remoteChain) {
        const remotePolyId = remoteChain.polyId;
        const remoteGateway = remoteChain.gateways[this.polyId][symbol];
        const gateway = this.gateways[remotePolyId][symbol];
        return gateway.bindGateway(remotePolyId, remoteGateway.address);
    }

    async crossRebalance(toPolyId, symbol, to, amount, fluxAmount) {
        const srcRouer = this.router;
        const srcToken = this.tokens[symbol];
        const srcGateway = this.gateways[toPolyId][symbol];
        const srcVault = this.vaults[symbol];
        const srcFlux = this.flux;
        const srcAccount = Hotpot.srcAccount;

        await srcToken.mint(srcAccount.address, amount);
        await srcToken.approve(srcVault.address, amount);
        await srcFlux.mint(srcAccount.address, fluxAmount);
        await srcFlux.approve(srcVault.address, fluxAmount);
        return srcRouer.crossRebalance(srcGateway.address, to, amount, fluxAmount);
    }

    async crossTransfer(toPolyId, symbol, to, amount, useFeeFlux) {
        const srcRouer = this.router;
        const srcToken = this.tokens[symbol];
        const srcGateway = this.gateways[toPolyId][symbol];
        const srcVault = this.vaults[symbol];
        const srcFlux = this.flux;
        const srcAccount = Hotpot.srcAccount;

        await srcToken.mint(srcAccount.address, amount);
        await srcToken.approve(srcVault.address, amount);
        let maxFeeFlux = 0;
        if (useFeeFlux) {
            maxFeeFlux = await this.feeFlux(srcGateway, amount);
            await srcFlux.mint(srcAccount.address, maxFeeFlux);
            await srcFlux.approve(srcVault.address, maxFeeFlux);
        }
        const crossTransfer = srcRouer.functions['crossTransfer(address,address,uint256,uint256)']
        return crossTransfer(srcGateway.address, to, amount, maxFeeFlux);
    }

    async crossTransferWithData(toPolyId, symbol, to, amount, useFeeFlux, data) {
        const srcRouer = this.router;
        const srcToken = this.tokens[symbol];
        const srcGateway = this.gateways[toPolyId][symbol];
        const srcVault = this.vaults[symbol];
        const srcFlux = this.flux;
        const srcAccount = Hotpot.srcAccount;

        await srcToken.mint(srcAccount.address, amount);
        await srcToken.approve(srcVault.address, amount);
        let maxFeeFlux = 0;
        if (useFeeFlux) {
            maxFeeFlux = await this.feeFlux(srcGateway, amount);
            await srcFlux.mint(srcAccount.address, maxFeeFlux);
            await srcFlux.approve(srcVault.address, maxFeeFlux);
        }
        const crossTransfer = srcRouer.functions['crossTransfer(address,address,uint256,uint256,bytes)']
        return crossTransfer(srcGateway.address, to, amount, maxFeeFlux, data);
    }

    async onCrossTransferByHotpoter(symbol, data, fromAddress, fromPolyId, account = Hotpot.srcAccount) {
        const gateway = this.gateways[fromPolyId][symbol];
        return gateway.connect(account).onCrossTransferByHotpoter(data, fromAddress, fromPolyId);
    }

    async deposit(symbol, amount, account = Hotpot.lpAccount) {
        const token = this.tokens[symbol];
        const vault = this.vaults[symbol];
        await token.mint(account.address, amount);
        await token.connect(account).approve(vault.address, amount);
        return vault.connect(account).deposit(amount);
    }

    async withdraw(symbol, share, account = Hotpot.lpAccount) {
        const vault = this.vaults[symbol];
        return vault.connect(account).withdraw(share);
    }

    async onCrossTransferExecute(symbol, remotePolyId, data) {
        const gateway = this.gateways[remotePolyId][symbol];
        return gateway.onCrossTransferExecute(data);
    }

    async harvestFlux(symbol, account) {
        const vault = this.vaults[symbol];
        return vault.connect(account).harvest();
    }

    async withdrawReserved(symbol, to, account = Hotpot.srcAccount) {
        const vault = this.vaults[symbol];
        return vault.connect(account).withdrawReserved(to);
    }

    async shareToAmount(share, totalShare, totalToken) {
        totalShare = totalShare || await vault.totalSupply();
        totalToken = totalToken || await vault.totalToken();
        return share.mul(totalToken).div(totalShare);
    }

    async amountToShare(amount, totalShare, totalToken) {
        totalShare = totalShare || await vault.totalSupply();
        totalToken = totalToken || await vault.totalToken();
        return amount.mul(totalShare).div(totalToken);
    }

    async toMeta(symbol, amount) {
        const token = this.tokens[symbol];
        const decimals = await token.decimals();
        return amount.mul(bn(10).pow(18 - decimals));
    }

    async toNative(symbol, amount) {
        const token = this.tokens[symbol];
        const decimals = await token.decimals();
        return amount.div(bn(10).pow(18 - decimals));
    }

    async feeFlux(gateway, amount) {
        const fee = await gateway.fee();
        const feeToken = fee.mul(amount).div(10000);
        const token = await gateway.token();
        return this.config.feeFlux(token, feeToken);
    }

    static async New(price = PRICE(1)) {
        const hotpot = new Hotpot();
        if (!Hotpot.polyMock) {
            Hotpot.polyMock = await deploy('PolyCall');
            Hotpot.accounts = await ethers.getSigners();
            Hotpot.srcAccount = this.accounts[0];
            Hotpot.destAccount = this.accounts[1];
            Hotpot.lpAccount = this.accounts[2];
        }
        await hotpot.deploy();
        await hotpot.init(price, 0, 0);
        for (let i = 0; i < Hotpot.chains.length; i++) {
            const chain = Hotpot.chains[i];
            await chain.setRemoteGas(hotpot);
            await hotpot.setRemoteGas(chain);
        }
        Hotpot.chains.push(hotpot);
        return hotpot;
    }

    static async AddToken(symbol, decimals, price) {
        for (let i = 0; i < Hotpot.chains.length; i++) {
            const chain = Hotpot.chains[i];
            await chain.addToken(symbol, decimals, price);
        }
        const deployed = {};
        for (let i = 0; i < Hotpot.chains.length; i++) {
            const chain = Hotpot.chains[i];
            const remoteChains = Hotpot.chains.filter(rchain => chain.polyId != rchain.polyId);
            for (let j = 0; j < remoteChains.length; j++) {
                const rchain = remoteChains[j];
                await chain.addGateway(rchain.polyId, symbol)
                if (deployed[rchain.polyId]) {
                    await rchain.bindGateway(symbol, chain);
                    await chain.bindGateway(symbol, rchain);
                }
            }
            deployed[chain.polyId] = true;
        }
    }

    static async CrossRebalance(srcChain, destChain, symbol, to, amount, fluxAmount, autoConfirm = false) {
        //await destChain.deposit(symbol, amount);
        const tx = await srcChain.crossRebalance(destChain.polyId, symbol, to, amount, fluxAmount);
        if (!autoConfirm) return tx;
        const receipt = await tx.wait(0);
        const iface = await ethers.getContractFactory('GatewayMock').then(gateway => gateway.interface);
        const CrossTransferSig = iface.getEventTopic('CrossTransfer');
        const crossLog = receipt.logs.find(log => log.topics[0] == CrossTransferSig)
        const crossEvent = iface.parseLog(crossLog);
        const isCrossV2 = crossEvent.args.crossId.shr(24 * 8) >= 2;

        const abi = new ethers.utils.AbiCoder();
        const crossData = abi.encode(['uint256', 'address', 'uint256', 'uint256', 'int256'], ['crossId', 'to', 'amount', 'fee', 'feeFlux'].map(key => crossEvent.args[key]));
        let tx2 = tx;
        if (!isCrossV2) {
            const srcGateway = srcChain.gateways[destChain.polyId][symbol];
            tx2 = await destChain.onCrossTransferByHotpoter(symbol, crossData, srcGateway.address, srcChain.polyId);
        }
        const destGateway = destChain.gateways[srcChain.polyId][symbol];
        const confirms = await destGateway.crossConfirms(ethers.utils.keccak256(crossData));
        if (confirms.mask(255) != (isCrossV2 ? 1 : 3)) throw `crossConfirms wrong! ${confirms.toHexString()}`;
        if (confirms.shr(255) != 1) throw `crossExecute wrong: ${confirms.toHexString()}`;
        //const status = await destGateway.existedIds(crossEvent.args.crossId);
        //if (status == 0) throw `existedIds wrong! ${status}`;
        return [tx, tx2];
    }
    static async CrossTransfer(srcChain, destChain, symbol, to, amount, useFeeFlux, autoConfirm = false) {
        //await destChain.deposit(symbol, amount);
        const tx = await srcChain.crossTransfer(destChain.polyId, symbol, to, amount, useFeeFlux);
        if (!autoConfirm) return tx;
        const receipt = await tx.wait(0);
        const iface = await ethers.getContractFactory('GatewayMock').then(gateway => gateway.interface);
        const CrossTransferSig = iface.getEventTopic('CrossTransfer');
        const crossLog = receipt.logs.find(log => log.topics[0] == CrossTransferSig)
        const crossEvent = iface.parseLog(crossLog);
        const isCrossV2 = crossEvent.args.crossId.shr(24 * 8) >= 2;

        const abi = new ethers.utils.AbiCoder();
        const crossData = abi.encode(['uint256', 'address', 'uint256', 'uint256', 'int256'], ['crossId', 'to', 'amount', 'fee', 'feeFlux'].map(key => crossEvent.args[key]));
        let tx2 = tx;
        if (!isCrossV2) {
            const srcGateway = srcChain.gateways[destChain.polyId][symbol];
            tx2 = await destChain.onCrossTransferByHotpoter(symbol, crossData, srcGateway.address, srcChain.polyId);
        }
        const destGateway = destChain.gateways[srcChain.polyId][symbol];
        const confirms = await destGateway.crossConfirms(ethers.utils.keccak256(crossData));
        if (confirms.mask(255) != (isCrossV2 ? 1 : 3)) throw `crossConfirms wrong! ${confirms.toHexString()}`;
        if (confirms.shr(255) != 1) throw `crossExecute wrong: ${confirms.toHexString()}`;
        //const status = await destGateway.existedIds(crossEvent.args.crossId);
        //if (status == 0) throw `existedIds wrong! ${status}`;
        return [tx, tx2];
    }
    static async CrossTransferWithData(srcChain, destChain, symbol, to, amount, useFeeFlux, data = Buffer.alloc(0), autoConfirm = false) {
        //await destChain.deposit(symbol, amount);
        const tx = await srcChain.crossTransferWithData(destChain.polyId, symbol, to, amount, useFeeFlux, data);
        if (!autoConfirm) return tx;
        const receipt = await tx.wait(0);
        const iface = await ethers.getContractFactory('GatewayMock').then(gateway => gateway.interface);
        const CrossTransferSig = iface.getEventTopic('CrossTransferWithData');
        const crossLog = receipt.logs.find(log => log.topics[0] == CrossTransferSig)
        const crossEvent = iface.parseLog(crossLog);
        const isCrossV2 = crossEvent.args.crossId.shr(24 * 8) >= 2;

        const abi = new ethers.utils.AbiCoder();
        const crossData = abi.encode(['uint256', 'address', 'uint256', 'uint256', 'int256', 'address', 'bytes'], ['crossId', 'to', 'amount', 'fee', 'feeFlux', 'from', 'extData'].map(key => crossEvent.args[key]));
        let tx2 = tx;
        if (!isCrossV2) {
            const srcGateway = srcChain.gateways[destChain.polyId][symbol];
            tx2 = await destChain.onCrossTransferByHotpoter(symbol, crossData, srcGateway.address, srcChain.polyId);
        }
        const destGateway = destChain.gateways[srcChain.polyId][symbol];
        const confirms = await destGateway.crossConfirms(ethers.utils.keccak256(crossData));
        if (confirms.mask(255) != (isCrossV2 ? 1 : 3)) throw `crossConfirms wrong! ${confirms.toHexString()}`;
        if (confirms.shr(255) != 1) throw `crossExecute wrong: ${confirms.toHexString()}`;
        //const status = await destGateway.existedIds(crossEvent.args.crossId);
        //if (status == 0) throw `existedIds wrong! ${status}`;
        return [tx, tx2];
    }

}

module.exports = Hotpot;