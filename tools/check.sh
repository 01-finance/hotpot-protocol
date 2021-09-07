set -e

status() {
    echo "\n"
    echo "--------------------"$NETENV $NETWORK
    yarn tags Check
}

net() {
    if [ "$NETENV" == "MAINNET" ];then
        echo $1_main
    else
        echo $1_test
    fi
}

ACTION=status

NETWORK=`net ok` $ACTION
NETWORK=`net heco` $ACTION
NETWORK=`net bsc` $ACTION
