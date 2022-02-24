require('dotenv').config()
const Web3 = require('web3')
const contract = require('./helpers/contract')
const priceApi = require('./utils/price')
const decode = require('./utils/decode')
const Types = require('./utils/types')

async function _price(token) {
    return await priceApi(token)
}

const _buy = async () => {
    const amount = process.argv[2]
    const ContractPCS = await contract.Instance(Types.ROUTER, process.env.PCS_ROUTER_CONTRACT)
    const ContractWBNB = await contract.Instance(Types.TOKEN, process.env.WBNB_CONTRACT)
    const tokenIn = process.env.WBNB_CONTRACT
    const tokenOut = process.env.TOKEN_CONTRACT

    const amountIn = decode.ToWei(amount, process.env.WBNB_DECIMALS)
    console.log('Approving...')
    var tx = await ContractWBNB.approve(
        process.env.PCS_ROUTER_CONTRACT,
        Web3.utils.toBN('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff').toString()
    ).send()
    if (tx.status) {
        const amounts = await ContractPCS.getAmountsOut(amountIn, [tokenIn, tokenOut]).call()

        var amountOutMin = decode.FromWei(amounts[amounts.length - 1], process.env.DECIMALS)
        const expectedAmount = amountOutMin
        amountOutMin -= ((amountOutMin * (process.env.SLIPPAGE / 100)))

        console.log(`
         Buying ${process.env.TOKEN_NAME}
         =================
         amountIn: ${amountIn.toString()} ${tokenIn} WBNB
         amountOut: ${parseFloat(expectedAmount).toFixed(9)} ${tokenOut} ${process.env.TOKEN_NAME}
       `)

        const { usd } = await _price(process.env.TOKEN_CONTRACT)
        decode.ToWei(amountOutMin, process.env.DECIMALS)
        const tx2 = await ContractPCS.swapExactETHForTokens(
            decode.ToWei(amountOutMin, process.env.DECIMALS),
            [tokenIn, tokenOut],
            process.env.GS_OWNER_ADDRESS,
            Date.now() + 1000 * 60 * 10
        ).send({ value: amountIn.toString(), gas: 1000000 })

        if (tx2.status) {
            const receipt = await tx2.transactionHash

            console.log('\x1b[32m%s\x1b[0m',
                `${process.env.TOKEN_NAME} bought successfully, Price: $${parseFloat(usd).toFixed(9)}\n=================`)
            console.log(`https://bscscan.com/tx/${receipt}`)
            console.log('\x1b[32m%s\x1b[0m', '=================')
        } else console.log('\x1b[31m%s\x1b[0m', `ERROR: can't buy ${process.env.TOKEN_NAME}`)
    } else {
        console.log('\x1b[31m%s\x1b[0m', `ERROR: Not allowence for ${process.env.TOKEN_NAME}`)
    }
}

_buy()