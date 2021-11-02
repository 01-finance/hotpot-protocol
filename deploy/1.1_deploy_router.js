const record = require('../helps/record');
const ChainsData = require('../helps/chains');

const _ = undefined;

Number.prototype.toAddress = function () {
    const hexStr = ethers.BigNumber.from(Number(this)).toHexString().slice(2);
    const pad = 40 - hexStr.length;
    return `0x${'0'.repeat(pad)}${hexStr}`;
}
String.prototype.toAddress = Number.prototype.toAddress;

function ContractAt(Contract, address) {
    console.log('ContractAt:', Contract, address);
    return ethers.getSigners().then(
        account => ethers.getContractAt(
            Contract,
            address,
            account[0]
        )
    );
}

const func = async function (hre) {
    const { deployments, ethers } = hre;
    const { deploy } = deployments;
    const { getChainId } = hre;
    hre.chainId = await getChainId();

    const accounts = await ethers.getSigners();
    const deployAcc = accounts[0].address;
    console.log(deployAcc);

    const path = ['RouterV3'];
    const deployed = record(hre.Record)._path(path);
    if (deployed) return;

    const chains = ChainsData(hre.Chains);
    //const tokens = ChainsData(hre.Tokens);
    const oracle = chains.Oracle;
    const polyId = chains.polyId;

    await deploy('Router', {
        from: deployAcc,
        args: [],
        log: true,
        deterministicDeployment: false,
    });

    const router = await deployments.get('Router');
    console.log('Router', router.address)

    record(hre.Record, path, router.address, hre.chainId);
};

module.exports = func;
func.tags = ['Router'];