const { expect } = require("chai");
const { ethers } = require('hardhat');
const Hotpot = require('./helps/Hotpot');

const testcasees = {
    tokens: [
        { symbol: 'USDT', decimals: 18, price: "1" },
        { symbol: 'BTC', decimals: 6, price: "40000" }
    ],
    vaults: [
        { symbol: 'USDT', amount: '10000' },
        { symbol: 'BTC', amount: "10" }
    ],
    crossTransfer: [
        {
            symbol: 'USDT',
            amount: '1000',
            useFeeFlux: false
        },
        {
            symbol: 'BTC',
            amount: '1',
            useFeeFlux: false
        },
        {
            symbol: 'USDT',
            amount: '2000',
            useFeeFlux: true
        },
        {
            symbol: 'BTC',
            amount: '2',
            useFeeFlux: true
        },
        {
            symbol: 'USDT',
            amount: '0.000000000000000001',
            useFeeFlux: true
        },
        {
            symbol: 'BTC',
            amount: '0.000001',
            useFeeFlux: true
        }
    ]
};

describe("Cross Test", function () {
    before(async function () {
        this.Chain1 = await Hotpot.New();
        this.Chain2 = await Hotpot.New();
        const tokens = testcasees.tokens;
        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];
            await Hotpot.AddToken(token.symbol, token.decimals, token.price);
        }
        this.Status = async (chain, symbol, toPolyId, toAddress = undefined) => {
            const token = chain.tokens[symbol];
            const decimals = await token.decimals();
            const vault = chain.vaults[symbol];
            const gateway = chain.gateways[toPolyId][symbol];
            const pendingFlux = async accounts => {
                const results = {
                    total: ethers.constants.Zero,
                    details: []
                };
                for (let i = 0; i < accounts.length; i++) {
                    const account = accounts[i];
                    const _pendingFlux = await vault.pendingReward(account.address);
                    results.total = _pendingFlux.add(results.total);
                    results.details.push({
                        account: account,
                        share: await vault.balanceOf(account.address),
                        reward: await vault.rewards(account.address),
                        pendingFlux: _pendingFlux,
                        fluxBalance: await chain.flux.balanceOf(account.address),
                        balance: await token.balanceOf(account.address)
                    });
                }
                return results;
            }

            return {
                token: {
                    token,
                    decimals,
                    toBalance: toAddress && await token.balanceOf(toAddress),
                },
                vault: {
                    vault,
                    gateway,
                    fluxBalance: await chain.flux.balanceOf(vault.address),
                    balance: await token.balanceOf(vault.address),
                    gateDebt: await vault.gateDebt(gateway.address),
                    totalShare: await vault.totalSupply(),
                    totalToken: await vault.totalToken(),
                    pendingFlux: await pendingFlux([Hotpot.srcAccount, Hotpot.destAccount, Hotpot.lpAccount]),
                    reservedFeeFlux: await vault.reservedFeeFlux(),
                    reservedFee: await vault.reservedFee(),
                    rewardFluxPerShareStored: await vault.rewardFluxPerShareStored()
                },
                gateway: {
                    vault,
                    gateway
                }
            };
        }
    });

    it("1. Vault Deposit test", async function () {

        const depositVault = async (chain, toPolyId) => {
            const vaults = testcasees.vaults;
            //const accounts = [Hotpot.srcAccount, Hotpot.destAccount, Hotpot.lpAccount];
            for (let i = 0; i < vaults.length; i++) {
                const vault = vaults[i];
                const symbol = vault.symbol;
                const token = chain.tokens[symbol];
                const decimals = await token.decimals();
                const amount = ethers.utils.parseUnits(vault.amount, decimals);

                const before = await this.Status(chain, symbol, toPolyId);
                const accounts = before.vault.pendingFlux.details.map(detail => detail.account);
                for (let j = 0; j < accounts.length; j++) {
                    const account = accounts[j];
                    await chain.deposit(symbol, amount, account);
                }
                const after = await this.Status(chain, symbol, toPolyId);

                const totalAmount = amount.mul(accounts.length);
                expect(after.vault.balance).to.eq(totalAmount);
                for (let j = 0; j < after.vault.pendingFlux.details.length; j++) {
                    const beforeDetail = before.vault.pendingFlux.details[j];
                    const afterDetail = after.vault.pendingFlux.details[j];
                    const tokenAmount = await chain.shareToAmount(afterDetail.share, after.vault.totalShare, after.vault.totalToken);
                    expect(tokenAmount).to.eq(amount);
                    expect(afterDetail.balance).to.eq(beforeDetail.balance); // deposit will mint automatic
                }
            }
        }
        await depositVault(this.Chain1, this.Chain2.polyId);
        await depositVault(this.Chain2, this.Chain1.polyId);
    });

    it("2. CrossTransfer test", async function () {
        const srcChain = this.Chain1;
        const destChain = this.Chain2;

        for (let i = 0; i < testcasees.crossTransfer.length; i++) {
            const casei = testcasees.crossTransfer[i];
            const symbol = casei.symbol;

            const to = Hotpot.destAccount.address;

            const beforeSrc = await this.Status(srcChain, symbol, destChain.polyId);
            const beforeDest = await this.Status(destChain, symbol, srcChain.polyId, to);

            const amount = ethers.utils.parseUnits(casei.amount, beforeSrc.token.decimals);

            const [tx,] = await Hotpot.CrossTransfer(srcChain, destChain, symbol, to, amount, casei.useFeeFlux, true);

            const receipt = await tx.wait(0);
            const iface = await ethers.getContractFactory('GatewayMock').then(gateway => gateway.interface);
            const CrossTransferSig = iface.getEventTopic('CrossTransfer');
            const crossLog = receipt.logs.find(log => log.topics[0] == CrossTransferSig)
            const crossEvent = iface.parseLog(crossLog);

            const afterSrc = await this.Status(srcChain, symbol, destChain.polyId);
            const afterDest = await this.Status(destChain, symbol, srcChain.polyId, to);

            const srcAmount = await srcChain.toNative(symbol, crossEvent.args.amount);
            const srcFee = await srcChain.toNative(symbol, crossEvent.args.fee);
            const destAmount = await destChain.toNative(symbol, crossEvent.args.amount);
            const destFee = await destChain.toNative(symbol, crossEvent.args.fee);

            if (casei.useFeeFlux) {
                expect(crossEvent.args.fee).to.equal(0, "fee shoule be 0 if useFeeFlux");
                const feeFlux = await srcChain.feeFlux(beforeSrc.vault.gateway, amount);
                expect(crossEvent.args.feeFlux).to.eq(feeFlux, "feeFlux different");
            }
            expect(afterSrc.vault.fluxBalance).to.eq(afterSrc.vault.gateDebt.debtFlux, "src chain debt should keep same");
            expect(afterDest.vault.pendingFlux.total.add(afterDest.vault.reservedFeeFlux)).to.equal(afterDest.vault.gateDebt.debtFlux.abs());

            expect(srcAmount.add(srcFee)).to.equal(amount);
            expect(afterDest.token.toBalance.sub(beforeDest.token.toBalance)).to.equal(destAmount);
            expect(afterSrc.vault.gateDebt.debt.sub(beforeSrc.vault.gateDebt.debt)).to.equal(amount);
            expect(beforeDest.vault.gateDebt.debt.sub(afterDest.vault.gateDebt.debt)).to.equal(destAmount.add(destFee));

            expect(afterSrc.vault.gateDebt.debtFlux.sub(beforeSrc.vault.gateDebt.debtFlux)).to.equal(crossEvent.args.feeFlux);
            expect(beforeDest.vault.gateDebt.debtFlux.sub(afterDest.vault.gateDebt.debtFlux)).to.equal(crossEvent.args.feeFlux);

            expect(beforeSrc.vault.gateDebt.debt.add(beforeDest.vault.gateDebt.debt)).to.equal(0);
            expect(beforeSrc.vault.gateDebt.debtFlux.add(beforeDest.vault.gateDebt.debtFlux)).to.equal(0);
            expect(afterSrc.vault.gateDebt.debt.add(afterDest.vault.gateDebt.debt)).to.equal(0);
            expect(afterSrc.vault.gateDebt.debtFlux.add(afterDest.vault.gateDebt.debtFlux)).to.equal(0);
        }
    });

    it("3. CrossTransferWithData test", async function () {
        const srcChain = this.Chain1;
        const destChain = this.Chain2;

        const CROSS_DATA = Buffer.from("hello world!");
        for (let i = 0; i < testcasees.crossTransfer.length; i++) {
            const casei = testcasees.crossTransfer[i];
            const symbol = casei.symbol;

            const to = destChain.callee.address;

            const beforeSrc = await this.Status(srcChain, symbol, destChain.polyId);
            const beforeDest = await this.Status(destChain, symbol, srcChain.polyId, to);

            const amount = ethers.utils.parseUnits(casei.amount, beforeSrc.token.decimals);

            const [tx, txOnTransfer] = await Hotpot.CrossTransferWithData(srcChain, destChain, symbol, to, amount, casei.useFeeFlux, CROSS_DATA, true);

            const receipt = await tx.wait(0);
            const iface = await ethers.getContractFactory('GatewayMock').then(gateway => gateway.interface);
            const CrossTransferSig = iface.getEventTopic('CrossTransferWithData');
            const crossLog = receipt.logs.find(log => log.topics[0] == CrossTransferSig)
            const crossEvent = iface.parseLog(crossLog);

            {
                const Callee = await ethers.getContractFactory('Callee');
                const iface = Callee.interface;
                const HotpotCallbackSig = iface.getEventTopic('HotpotCallback');
                const receipt = await txOnTransfer.wait(0);
                const callbackLog = receipt.logs.find(log => log.topics[0] == HotpotCallbackSig);
                const callbackEvent = iface.parseLog(callbackLog);
                expect(callbackEvent.args.data).to.equal(`0x${CROSS_DATA.toString('hex')}`, "cross data different!");
            }
            const afterSrc = await this.Status(srcChain, symbol, destChain.polyId);
            const afterDest = await this.Status(destChain, symbol, srcChain.polyId, to);

            const crossId = await crossEvent.args.crossId;
            const srcAmount = await srcChain.toNative(symbol, crossEvent.args.amount);
            const srcFee = await srcChain.toNative(symbol, crossEvent.args.fee);
            const destAmount = await destChain.toNative(symbol, crossEvent.args.amount);
            const destFee = await destChain.toNative(symbol, crossEvent.args.fee);

            //expect(await afterDest.gateway.gateway.existedIds(crossId)).to.equal(2, "cross not completed");
            if (casei.useFeeFlux) {
                expect(crossEvent.args.fee).to.equal(0, "fee shoule be 0 if useFeeFlux");
                const feeFlux = await srcChain.feeFlux(beforeSrc.vault.gateway, amount);
                expect(crossEvent.args.feeFlux).to.eq(feeFlux, "feeFlux different");
            }
            expect(afterSrc.vault.fluxBalance).to.eq(afterSrc.vault.gateDebt.debtFlux, "src chain debt should keep same");
            expect(afterDest.vault.pendingFlux.total.add(afterDest.vault.reservedFeeFlux)).to.equal(afterDest.vault.gateDebt.debtFlux.abs());

            expect(srcAmount.add(srcFee)).to.equal(amount);
            expect(afterDest.token.toBalance.sub(beforeDest.token.toBalance)).to.equal(destAmount);
            expect(afterSrc.vault.gateDebt.debt.sub(beforeSrc.vault.gateDebt.debt)).to.equal(amount);
            expect(beforeDest.vault.gateDebt.debt.sub(afterDest.vault.gateDebt.debt)).to.equal(destAmount.add(destFee));

            expect(afterSrc.vault.gateDebt.debtFlux.sub(beforeSrc.vault.gateDebt.debtFlux)).to.equal(crossEvent.args.feeFlux);
            expect(beforeDest.vault.gateDebt.debtFlux.sub(afterDest.vault.gateDebt.debtFlux)).to.equal(crossEvent.args.feeFlux);

            expect(beforeSrc.vault.gateDebt.debt.add(beforeDest.vault.gateDebt.debt)).to.equal(0);
            expect(beforeSrc.vault.gateDebt.debtFlux.add(beforeDest.vault.gateDebt.debtFlux)).to.equal(0);
            expect(afterSrc.vault.gateDebt.debt.add(afterDest.vault.gateDebt.debt)).to.equal(0);
            expect(afterSrc.vault.gateDebt.debtFlux.add(afterDest.vault.gateDebt.debtFlux)).to.equal(0);
        }
    });

    it("4. CrossRebalance test", async function () {
        const srcChain = this.Chain2;
        const destChain = this.Chain1;
        for (let i = 0; i < testcasees.crossTransfer.length; i++) {
            const casei = testcasees.crossTransfer[i];
            const symbol = casei.symbol;

            const to = Hotpot.destAccount.address;

            const beforeSrc = await this.Status(srcChain, symbol, destChain.polyId);
            const beforeDest = await this.Status(destChain, symbol, srcChain.polyId, to);

            const amount = beforeSrc.vault.gateDebt.debt.abs();
            const fluxAmount = beforeSrc.vault.gateDebt.debtFlux.abs();

            const [, txOnTransfer] = await Hotpot.CrossRebalance(srcChain, destChain, symbol, to, amount, fluxAmount, true);

            const afterSrc = await this.Status(srcChain, symbol, destChain.polyId);
            const afterDest = await this.Status(destChain, symbol, srcChain.polyId, to);

            expect(beforeSrc.vault.totalShare).to.eq(afterSrc.vault.totalShare);
            expect(beforeSrc.vault.totalToken).to.eq(afterSrc.vault.totalToken);
            expect(beforeDest.vault.totalShare).to.eq(afterDest.vault.totalShare);
            expect(beforeDest.vault.totalToken).to.eq(afterDest.vault.totalToken);

            const gateway = await ethers.getContractFactory('GatewayMock');
            var iface = gateway.interface;
            const OnCrossTransferMockSig = iface.getEventTopic('OnCrossTransferMock');
            const receipt = await txOnTransfer.wait(0);
            const crossLog = receipt.logs.find(log => log.topics[0] == OnCrossTransferMockSig)
            const crossEvent = iface.parseLog(crossLog);
            const srcAmount = await srcChain.toNative(symbol, crossEvent.args.amount);
            const srcFee = await srcChain.toNative(symbol, crossEvent.args.fee);
            const destAmount = await destChain.toNative(symbol, crossEvent.args.amount);
            const destFee = await destChain.toNative(symbol, crossEvent.args.fee);

            expect(crossEvent.args.fee).to.equal(0);

            expect(afterDest.vault.pendingFlux.total.add(afterDest.vault.reservedFeeFlux)).to.equal(afterDest.vault.fluxBalance);
            expect(afterSrc.vault.pendingFlux.total.add(afterSrc.vault.reservedFeeFlux)).to.equal(afterSrc.vault.fluxBalance);

            const _fluxAmount = ethers.constants.Zero.sub(fluxAmount)
            expect(crossEvent.args.feeFlux).to.equal(_fluxAmount);

            expect(srcAmount.add(srcFee)).to.equal(amount);
            expect(afterDest.token.toBalance.sub(beforeDest.token.toBalance)).to.equal(destAmount);
            expect(afterSrc.vault.gateDebt.debt.sub(beforeSrc.vault.gateDebt.debt)).to.equal(amount);
            expect(beforeDest.vault.gateDebt.debt.sub(afterDest.vault.gateDebt.debt)).to.equal(destAmount.add(destFee));

            expect(afterSrc.vault.gateDebt.debtFlux.sub(beforeSrc.vault.gateDebt.debtFlux)).to.equal(fluxAmount);
            expect(beforeDest.vault.gateDebt.debtFlux.sub(afterDest.vault.gateDebt.debtFlux)).to.equal(fluxAmount);

            expect(beforeSrc.vault.gateDebt.debt.add(beforeDest.vault.gateDebt.debt)).to.equal(0);
            expect(beforeSrc.vault.gateDebt.debtFlux.add(beforeDest.vault.gateDebt.debtFlux)).to.equal(0);
            expect(afterSrc.vault.gateDebt.debt.add(afterDest.vault.gateDebt.debt)).to.equal(0);
            expect(afterSrc.vault.gateDebt.debtFlux.add(afterDest.vault.gateDebt.debtFlux)).to.equal(0);
        }
    });

    it("5. GetFluxReward test", async function () {
        const srcChain = this.Chain1;
        const destChain = this.Chain2;
        const vaults = testcasees.vaults;
        for (let i = 0; i < vaults.length; i++) {
            const vault = vaults[i];
            const symbol = vault.symbol;
            const beforeDest = await this.Status(destChain, symbol, srcChain.polyId);
            expect(beforeDest.vault.pendingFlux.total).to.gt(0);
            for (let j = 0; j < beforeDest.vault.pendingFlux.details.length; j++) {
                const beforeDetail = beforeDest.vault.pendingFlux.details[j];
                await destChain.harvestFlux(symbol, beforeDetail.account);
            }
            const afterDest = await this.Status(destChain, symbol, srcChain.polyId);

            expect(afterDest.vault.pendingFlux.total).to.eq(0);
            expect(afterDest.vault.reservedFeeFlux).to.eq(afterDest.vault.fluxBalance);
            expect(beforeDest.vault.reservedFeeFlux).to.eq(afterDest.vault.reservedFeeFlux);
            for (let j = 0; j < afterDest.vault.pendingFlux.details.length; j++) {
                const beforeDetail = beforeDest.vault.pendingFlux.details[j];
                const afterDetail = afterDest.vault.pendingFlux.details[j];
                expect(afterDetail.pendingFlux).to.eq(0);
                expect(afterDetail.fluxBalance.sub(beforeDetail.fluxBalance)).to.eq(beforeDetail.pendingFlux);
            }
        }
    });

    it("6. Get Reserved test", async function () {
        const srcChain = this.Chain1;
        const destChain = this.Chain2;
        const vaults = testcasees.vaults;
        const to = Hotpot.srcAccount;
        for (let i = 0; i < vaults.length; i++) {
            const vault = vaults[i];
            const symbol = vault.symbol;
            const beforeDest = await this.Status(destChain, symbol, srcChain.polyId);
            await destChain.withdrawReserved(symbol, to.address);
            const afterDest = await this.Status(destChain, symbol, srcChain.polyId);
            expect(afterDest.vault.reservedFee).to.eq(0);
            expect(afterDest.vault.reservedFeeFlux).to.eq(0);
            expect(afterDest.vault.pendingFlux.total).to.equal(afterDest.vault.fluxBalance);

            const beforeDetail = beforeDest.vault.pendingFlux.details.find(detail => detail.account.address == to.address);
            const afterDetail = afterDest.vault.pendingFlux.details.find(detail => detail.account.address == to.address);
            expect(afterDetail.fluxBalance.sub(beforeDetail.fluxBalance)).to.eq(beforeDest.vault.reservedFeeFlux);
            expect(afterDetail.balance.sub(beforeDetail.balance)).to.eq(beforeDest.vault.reservedFee);
        }
    });

    it("7. Vault withdraw/exit", async function () {
        const exitVault = async (srcChain, destChain) => {
            const vaults = testcasees.vaults;
            const to = Hotpot.srcAccount;
            for (let i = 0; i < vaults.length; i++) {
                const vault = vaults[i];
                const symbol = vault.symbol;
                const beforeDest = await this.Status(destChain, symbol, srcChain.polyId);
                for (let j = 0; j < beforeDest.vault.pendingFlux.details.length; j++) {
                    const beforeDetail = beforeDest.vault.pendingFlux.details[j];
                    await destChain.withdraw(symbol, beforeDetail.share, beforeDetail.account);
                }
                const afterDest = await this.Status(destChain, symbol, srcChain.polyId);
                expect(afterDest.vault.balance).to.eq(0);
                for (let j = 0; j < afterDest.vault.pendingFlux.details.length; j++) {
                    const beforeDetail = beforeDest.vault.pendingFlux.details[j];
                    const afterDetail = afterDest.vault.pendingFlux.details[j];
                    const tokenAmount = await destChain.shareToAmount(beforeDetail.share, beforeDest.vault.totalShare, beforeDest.vault.totalToken);
                    expect(afterDetail.balance.sub(beforeDetail.balance)).to.eq(tokenAmount);
                    expect(afterDetail.share).to.eq(0);
                }
            }
        }
        await exitVault(this.Chain1, this.Chain2);
        await exitVault(this.Chain2, this.Chain1);
    });

    it("8. CrossTransfer pending test", async function () {
        const srcChain = this.Chain1;
        const destChain = this.Chain2;

        for (let i = 0; i < testcasees.crossTransfer.length; i++) {
            const casei = testcasees.crossTransfer[i];
            const symbol = casei.symbol;

            const to = Hotpot.destAccount.address;

            const beforeSrc = await this.Status(srcChain, symbol, destChain.polyId);
            const beforeDest = await this.Status(destChain, symbol, srcChain.polyId, to);

            const amount = beforeDest.vault.balance.add(1);

            const tx = await Hotpot.CrossTransfer(srcChain, destChain, symbol, to, amount, casei.useFeeFlux);

            const receipt = await tx.wait(0);
            const iface = await ethers.getContractFactory('GatewayMock').then(gateway => gateway.interface);
            const CrossTransferSig = iface.getEventTopic('CrossTransfer');
            const crossLog = receipt.logs.find(log => log.topics[0] == CrossTransferSig)
            const crossEvent = iface.parseLog(crossLog);

            const abi = new ethers.utils.AbiCoder();
            const crossData = abi.encode(['uint256', 'address', 'uint256', 'uint256', 'int256'], ['crossId', 'to', 'amount', 'fee', 'feeFlux'].map(key => crossEvent.args[key]));
            await destChain.onCrossTransferByHotpoter(symbol, crossData, beforeSrc.vault.gateway.address, srcChain.polyId);
            {
                const destGateway = beforeDest.gateway.gateway;
                const confirms = await destGateway.crossConfirms(ethers.utils.keccak256(crossData));
                expect(confirms).to.eq(3);
                await destChain.deposit(symbol, 1);
                await destChain.onCrossTransferExecute(symbol, srcChain.polyId, crossData);
            }
            const afterSrc = await this.Status(srcChain, symbol, destChain.polyId);
            const afterDest = await this.Status(destChain, symbol, srcChain.polyId, to);

            const srcAmount = await srcChain.toNative(symbol, crossEvent.args.amount);
            const srcFee = await srcChain.toNative(symbol, crossEvent.args.fee);
            const destAmount = await destChain.toNative(symbol, crossEvent.args.amount);
            const destFee = await destChain.toNative(symbol, crossEvent.args.fee);

            if (casei.useFeeFlux) {
                expect(crossEvent.args.fee).to.equal(0, "fee shoule be 0 if useFeeFlux");
                const feeFlux = await srcChain.feeFlux(beforeSrc.vault.gateway, amount);
                expect(crossEvent.args.feeFlux).to.eq(feeFlux, "feeFlux different");
            }
            expect(afterSrc.vault.fluxBalance).to.eq(afterSrc.vault.gateDebt.debtFlux, "src chain debt should keep same");
            expect(afterDest.vault.pendingFlux.total.add(afterDest.vault.reservedFeeFlux)).to.equal(afterDest.vault.gateDebt.debtFlux.abs());

            expect(srcAmount.add(srcFee)).to.equal(amount);
            expect(afterDest.token.toBalance.sub(beforeDest.token.toBalance)).to.equal(destAmount);
            expect(afterSrc.vault.gateDebt.debt.sub(beforeSrc.vault.gateDebt.debt)).to.equal(amount);
            expect(beforeDest.vault.gateDebt.debt.sub(afterDest.vault.gateDebt.debt)).to.equal(destAmount.add(destFee));

            expect(afterSrc.vault.gateDebt.debtFlux.sub(beforeSrc.vault.gateDebt.debtFlux)).to.equal(crossEvent.args.feeFlux);
            expect(beforeDest.vault.gateDebt.debtFlux.sub(afterDest.vault.gateDebt.debtFlux)).to.equal(crossEvent.args.feeFlux);

            expect(beforeSrc.vault.gateDebt.debt.add(beforeDest.vault.gateDebt.debt)).to.equal(0);
            expect(beforeSrc.vault.gateDebt.debtFlux.add(beforeDest.vault.gateDebt.debtFlux)).to.equal(0);
            expect(afterSrc.vault.gateDebt.debt.add(afterDest.vault.gateDebt.debt)).to.equal(0);
            expect(afterSrc.vault.gateDebt.debtFlux.add(afterDest.vault.gateDebt.debtFlux)).to.equal(0);

            await expect(
                destChain.onCrossTransferExecute(symbol, srcChain.polyId, crossData)
            ).to.be.revertedWith("executed");
        }
    });

    it("9. CrossTransferWithData pending test", async function () {
        const srcChain = this.Chain1;
        const destChain = this.Chain2;

        const CROSS_DATA = Buffer.from("hello world!");
        for (let i = 0; i < testcasees.crossTransfer.length; i++) {
            const casei = testcasees.crossTransfer[i];
            const symbol = casei.symbol;

            const to = destChain.callee.address;

            const beforeSrc = await this.Status(srcChain, symbol, destChain.polyId);
            const beforeDest = await this.Status(destChain, symbol, srcChain.polyId, to);

            const amount = beforeDest.vault.balance.add(1);

            const tx = await Hotpot.CrossTransferWithData(srcChain, destChain, symbol, to, amount, casei.useFeeFlux, CROSS_DATA);

            const receipt = await tx.wait(0);
            const iface = await ethers.getContractFactory('GatewayMock').then(gateway => gateway.interface);
            const CrossTransferSig = iface.getEventTopic('CrossTransferWithData');
            const crossLog = receipt.logs.find(log => log.topics[0] == CrossTransferSig)
            const crossEvent = iface.parseLog(crossLog);

            const abi = new ethers.utils.AbiCoder();
            const crossData = abi.encode(['uint256', 'address', 'uint256', 'uint256', 'int256', 'address', 'bytes'], ['crossId', 'to', 'amount', 'fee', 'feeFlux', 'from', 'extData'].map(key => crossEvent.args[key]));
            let txOnTransfer = await destChain.onCrossTransferByHotpoter(symbol, crossData, beforeSrc.vault.gateway.address, srcChain.polyId);
            {
                const destGateway = beforeDest.gateway.gateway;
                const confirms = await destGateway.crossConfirms(ethers.utils.keccak256(crossData));
                expect(confirms).to.eq(3);
                await destChain.deposit(symbol, 1);
                txOnTransfer = await destChain.onCrossTransferExecute(symbol, srcChain.polyId, crossData);
            }
            {
                const Callee = await ethers.getContractFactory('Callee');
                const iface = Callee.interface;
                const HotpotCallbackSig = iface.getEventTopic('HotpotCallback');
                const receipt = await txOnTransfer.wait(0);
                const callbackLog = receipt.logs.find(log => log.topics[0] == HotpotCallbackSig);
                const callbackEvent = iface.parseLog(callbackLog);
                expect(callbackEvent.args.data).to.equal(`0x${CROSS_DATA.toString('hex')}`, "cross data different!");
            }
            const afterSrc = await this.Status(srcChain, symbol, destChain.polyId);
            const afterDest = await this.Status(destChain, symbol, srcChain.polyId, to);

            const crossId = await crossEvent.args.crossId;
            const srcAmount = await srcChain.toNative(symbol, crossEvent.args.amount);
            const srcFee = await srcChain.toNative(symbol, crossEvent.args.fee);
            const destAmount = await destChain.toNative(symbol, crossEvent.args.amount);
            const destFee = await destChain.toNative(symbol, crossEvent.args.fee);

            //expect(await afterDest.gateway.gateway.existedIds(crossId)).to.equal(2, "cross not completed");

            if (casei.useFeeFlux) {
                expect(crossEvent.args.fee).to.equal(0, "fee shoule be 0 if useFeeFlux");
                const feeFlux = await srcChain.feeFlux(beforeSrc.vault.gateway, amount);
                expect(crossEvent.args.feeFlux).to.eq(feeFlux, "feeFlux different");
            }
            expect(afterSrc.vault.fluxBalance).to.eq(afterSrc.vault.gateDebt.debtFlux, "src chain debt should keep same");
            expect(afterDest.vault.pendingFlux.total.add(afterDest.vault.reservedFeeFlux)).to.equal(afterDest.vault.gateDebt.debtFlux.abs());

            expect(srcAmount.add(srcFee)).to.equal(amount);
            expect(afterDest.token.toBalance.sub(beforeDest.token.toBalance)).to.equal(destAmount);
            expect(afterSrc.vault.gateDebt.debt.sub(beforeSrc.vault.gateDebt.debt)).to.equal(amount);
            expect(beforeDest.vault.gateDebt.debt.sub(afterDest.vault.gateDebt.debt)).to.equal(destAmount.add(destFee));

            expect(afterSrc.vault.gateDebt.debtFlux.sub(beforeSrc.vault.gateDebt.debtFlux)).to.equal(crossEvent.args.feeFlux);
            expect(beforeDest.vault.gateDebt.debtFlux.sub(afterDest.vault.gateDebt.debtFlux)).to.equal(crossEvent.args.feeFlux);

            expect(beforeSrc.vault.gateDebt.debt.add(beforeDest.vault.gateDebt.debt)).to.equal(0);
            expect(beforeSrc.vault.gateDebt.debtFlux.add(beforeDest.vault.gateDebt.debtFlux)).to.equal(0);
            expect(afterSrc.vault.gateDebt.debt.add(afterDest.vault.gateDebt.debt)).to.equal(0);
            expect(afterSrc.vault.gateDebt.debtFlux.add(afterDest.vault.gateDebt.debtFlux)).to.equal(0);

            await expect(
                destChain.onCrossTransferExecute(symbol, srcChain.polyId, crossData)
            ).to.be.revertedWith("executed");

        }
    });
});