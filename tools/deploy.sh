set -e
deploy() {
    yarn tags Access
    yarn tags Router
    yarn tags Config
    yarn tags ExtCaller
    yarn tags Vaults
    yarn tags Gateways
    yarn tags Lens
}

deployRouterV3() {
    yarn tags Router
}

deployExtCaller() {
    yarn tags ExtCaller
}

bind() {
    yarn tags Bind
}

net() {
    if [ "$NETENV" == "MAINNET" ];then
        echo $1_main
    else
        echo $1_test
    fi
}

npx hardhat compile

ACTION=deployRouterV3

#NETWORK=`net arbitrum` $ACTION
NETWORK=`net ok` $ACTION
NETWORK=`net heco` $ACTION
NETWORK=`net bsc` $ACTION
NETWORK=`net polygon` $ACTION


# 部署流程
# 1. 部署合约
# 2. 绑定gateway
# 3. 配置ACCESS(hotpoter, rebalancer...)
# 4. 配置Router(gas,gasPrice)

