
require("./hotpot.task");
require("@openzeppelin/hardhat-upgrades");
require("@nomiclabs/hardhat-ethers");
require("hardhat-deploy");
require("@nomiclabs/hardhat-waffle");
const { testnet, mainnet } = require('./networks.json');
//const record = require('./helps/record');
const { extendEnvironment } = require('hardhat/config');

extendEnvironment(hre => {
  // getter setter?
  const netenv = process.env.NETENV;
  if (!netenv) {
    console.log("export NETENV=XXX // local,mainnet,testnet");
    return;
  }
  hre.netenv = netenv.toLowerCase();
  hre.Record = `record_${hre.netenv}.json`;
  //hre.Chains = "chains_testnet.json";
  hre.Chains = `chains_${hre.netenv}.json`;
  if (hre.hardhatArguments.network != undefined)
    console.log(`---------------------using NETWORK ${hre.network.name.toUpperCase()}`)
});

function networks(network, suffix, prikey) {
  const keys = Object.keys(network);
  const nets = {};
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const chain = `${key}_${suffix}`;
    const net = network[key];
    nets[chain] = {
      ...net,
      accounts: prikey ? [prikey] : undefined,
    }
  }
  return nets;
}

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
  //defaultNetwork: 'hardhat',
  networks: {
    chainA: {
      url: "http://127.0.0.1:11000"
    },
    chainB: {
      url: "http://127.0.0.1:12000"
    },
    fork: {
      url: "http://127.0.0.1:8545/"
    },
    ...networks(mainnet, 'main', process.env.PRIKEY),
    ...networks(testnet, 'test', process.env.PRIKEY)
  },
  solidity: {
    version: "0.6.12",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  }
};
