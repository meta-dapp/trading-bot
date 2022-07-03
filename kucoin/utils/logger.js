const colors = {
    green: '\x1b[32m%s\x1b[0m',
    red: '\x1b[31m%s\x1b[0m',
    gray: '\x1b[37m%s\x1b[0m'
}

const logColor = (color, content) => {
    console.log(color, content)
}

const log = (content) => {
    console.log(content)
}


module.exports = {
    logColor,
    log,
    colors
}