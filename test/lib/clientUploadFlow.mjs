//供api-upload-stall-exit測試之子行程: 對停滯伺服器執行conn→upload(逾時)→quit後自然結束, 不呼叫process.exit, 用以驗證上傳逾時中止與清理後event loop可清空使行程自行退出
import WFtp from '../../src/WFtp.mjs'

let [transportation, port, timeLimit, fpLocal] = process.argv.slice(2)

let ftp = WFtp({
    transportation,
    hostname: '127.0.0.1',
    port: Number(port),
    username: 'u1',
    password: 'p1',
    timeLimit: Number(timeLimit),
})

let main = async () => {
    await ftp.conn()
    await ftp.upload(fpLocal, './t.bin')
        .catch((err) => {
            console.log('upload err:', String(err))
        })
    await ftp.quit()
        .catch((err) => {
            console.log('quit err:', String(err))
        })
    console.log('flow done')
}

main()
