set -e

FixedGas() {
    echo "\n"
    echo "--------------------"$NETENV $NETWORK
    yarn tags FixedGas
}


net() {
    if [ "$NETENV" == "MAINNET" ];then
        echo $1_main
    else
        echo $1_test
    fi
}

npx hardhat compile


ACTION=FixedGas

#NETWORK=`net arbitrum` $ACTION
#NETWORK=`net polygon` $ACTION
NETWORK=`net ok` $ACTION
#NETWORK=`net heco` $ACTION
NETWORK=`net bsc` $ACTION
