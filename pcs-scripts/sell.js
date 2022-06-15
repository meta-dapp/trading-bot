require('dotenv').config()
const Web3 = require('web3')
const contract = require('./helpers/contract')
const priceApi = require('./utils/price')
const decode = require('./utils/decode')
const Types = require('./utils/types')

async function _price(token) {
    return await priceApi(token)
}

const _sell = async () => {
    const amount = process.argv[2]
    const ContractPCS = await contract.Instance(Types.ROUTER, process.env.PCS_ROUTER_CONTRACT)
    const ContractTOKEN = await contract.Instance(Types.TOKEN, process.env.TOKEN_CONTRACT)
    const tokenIn = process.env.TOKEN_CONTRACT
    const tokenOut = process.env.WBNB_CONTRACT

    const amountIn = decode.ToWei(amount, process.env.DECIMALS)
    console.log('Approving...')
    var tx = await ContractTOKEN.approve(
        process.env.PCS_ROUTER_CONTRACT,
        Web3.utils.toBN('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff').toString()
    ).send()
    if (tx.status) {
        const amounts = await ContractPCS.getAmountsOut(amountIn, [tokenIn, tokenOut]).call()

        var amountOutMin = decode.FromWei(amounts[amounts.length - 1], process.env.WBNB_CONTRACT)
        const expectedAmount = amountOutMin
        amountOutMin -= ((amountOutMin * (process.env.SLIPPAGE / 100)))

        console.log(`
         Selling ${process.env.TOKEN_NAME}
         =================
         amountIn: ${amountIn.toString()} ${tokenIn} ${process.env.TOKEN_NAME}
         amountOut: ${parseFloat(expectedAmount).toFixed(9)} ${tokenOut} WBNB
       `)

        const { usd } = await _price(process.env.WBNB_CONTRACT)
        decode.ToWei(amountOutMin, process.env.WBNB_DECIMALS)
        const tx2 = await ContractPCS.swapExactTokensForETH(
            amountIn,
            decode.ToWei(amountOutMin, process.env.WBNB_DECIMALS),
            [tokenIn, tokenOut],
            process.env.GS_OWNER_ADDRESS,
            Date.now() + 1000 * 60 * 10
        ).send({ gas: 1000000 })

        if (tx2.status) {
            const receipt = await tx2.transactionHash

            console.log('\x1b[31m%s\x1b[0m',
                `${process.env.TOKEN_NAME} sold successfully, Price: $${parseFloat(usd).toFixed(9)}\n=================`)
            console.log(`https://bscscan.com/tx/${receipt}`)
            console.log('\x1b[31m%s\x1b[0m', '=================')
        } else console.log('\x1b[31m%s\x1b[0m', `ERROR: can't sell ${process.env.TOKEN_NAME}`)
    } else {
        console.log('\x1b[31m%s\x1b[0m', `ERROR: Not allowence for ${process.env.TOKEN_NAME}`)
    }
}

_sell()