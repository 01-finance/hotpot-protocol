const record = require('../helps/record');
const ChainsData = require('../helps/chains');

Number.prototype.toAddress = function () {
    const hexStr = ethers.BigNumber.from(Number(this)).toHexString().slice(2);
    const pad = 40 - hexStr.length;
    return `0x${'0'.repeat(pad)}${hexStr}`;
}
String.prototype.toAddress = Number.prototype.toAddress;

function ContractAt(Contract, address) {
    return ethers.getSigners().then(
        account => ethers.getContractAt(
            Contract,
            address,
            account[0]
        )
    );
}

const u3 = ethers.utils.parseUnits('3', 18);
const u9 = ethers.utils.parseUnits('9', 18);
const GasFixFee = {
    "BSC": [u3],
    "HECO": [u3],
    "OEC": [u3],
    "POLYGON": [u3],
    "ARBITRUM": [u9]
}

const func = async function (hre) {
    const { deployments, ethers } = hre;
    const { deploy } = deployments;
    const { getChainId } = hre;
    hre.chainId = await getChainId();

    const accounts = await ethers.getSigners();
    const deployAcc = accounts[0].address;
    console.log(deployAcc);

    const Deployed = record(hre.Record);
    //const tokens = ChainsData(hre.Tokens);

    const chains = ChainsData(hre.Chains);

    const configC = await ContractAt('Config', Deployed.Config);

    const remotePolyIds = Object.keys(Deployed.Gateways);
    const gases = remotePolyIds.map(polyId => GasFixFee[chains._polyToName(polyId)]);
    console.log(remotePolyIds, gases);
    //return;
    for (let polyId of remotePolyIds) {
        console.log(polyId)
        console.log("price:", polyId, await configC.crossFee(polyId))
    }
    await configC.setCrossFee(remotePolyIds, gases.map(g => g[0]));
};

module.exports = func;
func.tags = ['FixedGas'];