set -e
upgradeVaults() {
    yarn tags upgradeVaults
}
upgradeGateways() {
    yarn tags upgradeGateways
}

upgradeLens() {
    yarn tags upgradeLens
}

upgradeAccess() {
    yarn tags upgradeAccess
}

upgradeConfig() {
    yarn tags upgradeConfig
}

upgradeLens() {
    yarn tags upgradeLens
}

net() {
    if [ "$NETENV" == "MAINNET" ];then
        echo $1_main
    else
        echo $1_test
    fi
}

npx hardhat compile

UPGRADE=upgradeConfig

#NETWORK=`net arbitrum` $UPGRADE
NETWORK=`net polygon` $UPGRADE
NETWORK=`net ok` $UPGRADE
NETWORK=`net heco` $UPGRADE
NETWORK=`net bsc` $UPGRADE