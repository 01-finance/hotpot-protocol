const { ethers, upgrades } = require('hardhat');
const record = require('../helps/record');
const ContractKey = ["Access"];
const Contract = "Access";
const DeployedBytecode = require(`../artifacts/contracts/${Contract}.sol/${Contract}.json`).deployedBytecode;

function ContractAt(Contract, address) {
  return ethers.getSigners().then(
    account => ethers.getContractAt(
      Contract,
      address,
      account[0]
    )
  );
}

async function upgradeProxy(oldAddress, Contract) {
  const instance = await ContractAt(Contract, oldAddress)
  const newC = await ethers.getContractFactory(Contract);
  if (await implCheck(oldAddress, DeployedBytecode)) {
    console.log(`>> SameImpl ${Contract} at ${instance.address}`);
  } else {
    const upgraded = await upgrades.upgradeProxy(instance.address, newC);
    console.log(`>> Upgraded ${Contract} at ${upgraded.address}`);
  }
  return instance;
}

async function getProxyImplementation(address) {
  const proxyAdmin = await upgrades.admin.getInstance();
  return proxyAdmin.callStatic.getProxyImplementation(address);
}

const CodeCache = {}
async function implCheck(address, newImplCode) {
  const impl = await getProxyImplementation(address);
  if (!CodeCache[impl]) {
    CodeCache[impl] = await ethers.provider.getCode(impl);
  }
  return newImplCode == CodeCache[impl];
}

module.exports = async function (hre) {
  const { getChainId } = hre;
  hre.chainId = await getChainId();
  const accounts = await ethers.getSigners();
  const deployAcc = accounts[0].address;
  console.log(hre.chainId, deployAcc);

  const Deployed = record(hre.Record);
  const oldAddress = ContractKey.reduce((r, key) => r[key], Deployed);
  const vaults = [oldAddress];
  console.log(vaults)
  for (let i = 0; i < vaults.length; i++) {
    const vault = vaults[i];
    const oldC = await ContractAt(Contract, vault)
    const newC = await upgradeProxy(vault, Contract);
    //await newC.fix(Deployed.Config);
    //console.log(i, await oldC.config())
  }
}
module.exports.tags = ["upgradeAccess"];
