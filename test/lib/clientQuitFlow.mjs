//供api-ftp-stall-exit測試之子行程: 對停滯伺服器執行conn→ls→quit後自然結束, 不呼叫process.exit, 用以驗證quit硬關閉socket後event loop可清空使行程自行退出
import WFtp from '../../src/WFtp.mjs'

let port = Number(process.argv[2])
let timeLimit = Number(process.argv[3]) || 2000

let ftp = WFtp({
    transportation: 'FTP',
    hostname: '127.0.0.1',
    port,
    username: 'u1',
    password: 'p1',
    timeLimit,
})

let main = async () => {
    await ftp.conn()
        .catch((err) => {
            console.log('conn err:', err.toString())
        })
    await ftp.ls('.')
        .catch((err) => {
            console.log('ls err:', err.toString())
        })
    await ftp.quit()
        .catch((err) => {
            console.log('quit err:', err.toString())
        })
    console.log('flow done')
}

main()
