//供api-conn-exit測試之子行程: 驗證連線錯誤不使行程中止, 且完成後行程自行結束(不呼叫process.exit)
//  用法: node clientConnFlow.mjs <情境> <FTP|SFTP> <port> <timeLimit>
//  情境: 'refused'(連不上之伺服器): conn→ls; 'reset'(閒置時控制連線被RST): conn→ls→等父行程通知→ls(最多5次); 'quit'(伺服器不關閉連線): conn→quit
import WFtp from '../../src/WFtp.mjs'

let [scenario, transportation, portArg, tlArg] = process.argv.slice(2)

let ftp = WFtp({
    transportation,
    hostname: '127.0.0.1',
    port: Number(portArg),
    username: 'u1',
    password: 'p1',
    timeLimit: Number(tlArg) || 3000,
})

let run = (label, p) => {
    return p.then(
        () => {
            console.log(`${label} ok`)
            return true
        },
        (err) => {
            console.log(`${label} err: ${String(err)}`)
            return false
        },
    )
}

let waitParent = () => {
    return new Promise((resolve) => {
        process.once('message', () => {
            process.disconnect()
            resolve()
        })
        process.send('ready')
    })
}

let main = async () => {
    await run('conn', ftp.conn())
    if (scenario === 'refused') {
        await run('ls', ftp.ls('.'))
    }
    else if (scenario === 'reset') {
        await run('ls', ftp.ls('.'))
        await waitParent()
        let ok = false
        for (let i = 0; i < 5 && !ok; i++) {
            ok = await run('ls2', ftp.ls('.'))
        }
        await run('quit', ftp.quit())
    }
    else if (scenario === 'quit') {
        await run('quit', ftp.quit())
    }
    console.log('flow done')
}

main()
