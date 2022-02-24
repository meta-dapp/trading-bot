const { toBn } = require("evm-bn")
const ethers = require('ethers')

const FromWei = (amount, decimals) => {
    return amount / (10 ** decimals)
}

const ToWei = (amount, decimals) => {
    return ethers.BigNumber
        .from(toBn(amount.toString(), decimals)._hex).toString()
}

module.exports = {
    FromWei,
    ToWei
}