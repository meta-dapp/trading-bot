require('dotenv').config()
const client = require('./services/client')

const PAIR1 = process.argv[2] || 'BTC'
const PAIR2 = process.argv[3] || 'USDT'
const AMOUNT = process.argv[4] || 15
const LEVERAGE = process.argv[5] || 5
const TAKE_PROFIT_PERCENT = process.argv[6] || 0.3
const STOP_LOSS_PERCENT = process.argv[7] || 1

const replaceMultipler = (number, decimals, multipler) => {
    number = number.toString()
    var result = number.includes('.') ? number.split('.')[1] : ''
    if (result.length == decimals) {
        result = result.slice(0, -1) + multipler
        result = (number.includes('.')
            ? number.split('.')[0] : number) + '.' + result
    } else {
        result = number
    }

    return result
}

async function placeLongPosition() {
    const market = `${PAIR1}${PAIR2}`// BTCUSDT
    const account = (await client.futuresAccount
        .account(`${market}_UMCBL`, PAIR2)).data

    const { balance, leverage, marginMode } = {
        leverage: account.fixedLongLeverage,
        marginMode: account.marginMode,
        balance: account.available
    }

    const changeMargin = {
        marginCoin: PAIR2,
        symbol: `${market}_UMCBL`
    }

    if (marginMode === 'crossed') {
        // Set margin mode to insolated
        console.log('Setting margin mode to insolated...')
        await client.futuresAccount.setMarginMode({
            ...
            changeMargin,
            marginMode: 'fixed'
        })
    }

    if (leverage !== parseInt(LEVERAGE)) {
        console.log(`Setting leverage to ${LEVERAGE} ...`)
        // Set leverage
        await client.futuresAccount.setLeverage({
            ...
            changeMargin,
            leverage: LEVERAGE,
            holdSide: 'long'
        })
    }

    const symbolInfo = (await client.futuresMarket.contracts(`umcbl`))
        .data.filter(item => item.baseCoin === PAIR1)[0]


    const { pricePlace, multiplier, sizePlace, minSize } = {
        pricePlace: symbolInfo.pricePlace,
        multiplier: symbolInfo.priceEndStep,
        sizePlace: symbolInfo.volumePlace,
        minSize: symbolInfo.minTradeNum
    }

    if (balance * LEVERAGE > minSize) {
        const amountBuyPAIR2 = AMOUNT * LEVERAGE
        const price = (await client.futuresMarket.markPrice(`${market}_UMCBL`))
            .data.markPrice

        const amountBuyPAIR1 = parseFloat(amountBuyPAIR2) / parseFloat(price)
        var tp = parseFloat(parseFloat(price)
            + (parseFloat(price) * TAKE_PROFIT_PERCENT / 100)).toFixed(pricePlace)

        var sl = parseFloat(parseFloat(price)
            - (parseFloat(price) * STOP_LOSS_PERCENT / 100)).toFixed(pricePlace)

        tp = replaceMultipler(tp, pricePlace, multiplier)
        sl = replaceMultipler(sl, pricePlace, multiplier)

        await client.futuresPosition.placePlan({
            symbol: `${market}_UMCBL`,
            marginCoin: PAIR2,
            triggerPrice: parseFloat(price).toFixed(pricePlace),
            side: 'open_long',
            orderType: 'market',
            triggerType: 'market_price',
            size: parseFloat(amountBuyPAIR1).toFixed(sizePlace),
            presetTakeProfitPrice: tp,
            presetStopLossPrice: sl
        })
    }

}

placeLongPosition()