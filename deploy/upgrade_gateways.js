const { ethers, upgrades } = require('hardhat');
const ChainsData = require('../helps/chains');
const record = require('../helps/record');
const ContractKey = ["Gateways"];
const Contract = "Gateway";
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
    const upgraded = await upgrades.upgradeProxy(instance.address, newC, { unsafeAllowRenames: true });
    console.log(`>> Upgraded ${Contract} at ${upgraded.address}`);
  }
  return instance;
}

/*
export interface ValidationOptions {
  unsafeAllowCustomTypes?: boolean;
  unsafeAllowLinkedLibraries?: boolean;
  unsafeAllowRenames?: boolean;
  unsafeAllow?: ValidationError['kind'][];
  kind?: ProxyDeployment['kind'];
}
*/

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
  console.log(deployAcc);

  console.log(hre.Chains, hre.chainId)
  const chains = ChainsData(hre.Chains);
  const Deployed = record(hre.Record);
  const oldAddress = ContractKey.reduce((r, key) => r[key], Deployed);
  const remotePolyIds = Object.keys(oldAddress);

  for (let i = 0; i < remotePolyIds.length; i++) {
    const remotePolyId = remotePolyIds[i];
    const gateways = oldAddress[remotePolyId];
    const symbols = Object.keys(gateways);
    const chainName = chains._polyToName(remotePolyId);
    const ARBITRUM = "ARBITRUM";
    const hasARBITRUM = [chains._name, chainName].includes(ARBITRUM);
    console.log('to:', i, chainName, remotePolyId, chains._name, hasARBITRUM);
    if (!hasARBITRUM) continue;
    for (let j = 0; j < symbols.length; j++) {
      const symbol = symbols[j];
      const gateway = gateways[symbol];
      console.log('token:', chainName, symbol, gateway);
      const oldC = await ContractAt(Contract, gateway)
      const newC = await upgradeProxy(gateway, Contract);
    }
  }

}
module.exports.tags = ["upgradeGateways"];
