const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

// MyFXBook API配置
const MYFXBOOK_CONFIG = {
    loginUrl: 'https://www.myfxbook.com/api/login.json',
    accountsUrl: 'https://www.myfxbook.com/api/get-my-accounts.json',
    // 使用base64编码的凭据（简单加密）
    credentials: {
        email: 'cmV4bGVla2FuZzE2QGdtYWlsLmNvbQ==', // rexleekang16@gmail.com
        password: 'S29uZ2xvbmcjNiM5' // Konglong#6#9
    }
};

// 数据文件路径
const DATA_FILE = path.join(__dirname, 'data', 'wl-xau-data.json');
const DATA_DIR = path.join(__dirname, 'data');

class DataFetcher {
    constructor() {
        this.sessionId = null;
        this.lastUpdate = 0;
        this.updateInterval = 2 * 60 * 60 * 1000; // 2小时
        this.isUpdating = false;
    }

    // 解码base64凭据
    decodeCredentials() {
        return {
            email: Buffer.from(MYFXBOOK_CONFIG.credentials.email, 'base64').toString(),
            password: Buffer.from(MYFXBOOK_CONFIG.credentials.password, 'base64').toString()
        };
    }

    // 登录获取session ID
    async login() {
        try {
            const credentials = this.decodeCredentials();
            const formData = new URLSearchParams();
            formData.append('email', credentials.email);
            formData.append('password', credentials.password);

            const response = await fetch(MYFXBOOK_CONFIG.loginUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: formData
            });

            const data = await response.json();
            
            if (!data.error && data.session) {
                this.sessionId = data.session;
                console.log('✅ 登录成功，获取到session ID');
                return true;
            } else {
                console.error('❌ 登录失败:', data.message);
                return false;
            }
        } catch (error) {
            console.error('❌ 登录过程中出错:', error.message);
            return false;
        }
    }

    // 获取账户数据
    async fetchAccountData() {
        if (!this.sessionId) {
            console.log('⚠️ 没有有效的session ID，尝试重新登录...');
            if (!(await this.login())) {
                return null;
            }
        }

        try {
            const response = await fetch(`${MYFXBOOK_CONFIG.accountsUrl}?session=${this.sessionId}`);
            const data = await response.json();

            if (!data.error && data.accounts) {
                // 查找WL XAU账户
                const wlXauAccount = data.accounts.find(acc => acc.name === 'WL XAU');
                if (wlXauAccount) {
                    console.log('✅ 成功获取WL XAU账户数据');
                    return wlXauAccount;
                } else {
                    console.log('⚠️ 未找到WL XAU账户');
                    return null;
                }
            } else {
                console.error('❌ 获取账户数据失败:', data.message);
                // 如果是session过期，尝试重新登录
                if (data.message.includes('session')) {
                    this.sessionId = null;
                    return await this.fetchAccountData();
                }
                return null;
            }
        } catch (error) {
            console.error('❌ 获取账户数据过程中出错:', error.message);
            return null;
        }
    }

    // 保存数据到文件
    async saveData(accountData) {
        try {
            // 确保数据目录存在
            if (!fs.existsSync(DATA_DIR)) {
                fs.mkdirSync(DATA_DIR, { recursive: true });
            }

            const dataToSave = {
                timestamp: new Date().toISOString(),
                lastUpdate: Date.now(),
                account: accountData
            };

            fs.writeFileSync(DATA_FILE, JSON.stringify(dataToSave, null, 2));
            console.log('✅ 数据已保存到文件');
            return true;
        } catch (error) {
            console.error('❌ 保存数据失败:', error.message);
            return false;
        }
    }

    // 读取已保存的数据
    readSavedData() {
        try {
            if (fs.existsSync(DATA_FILE)) {
                const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
                console.log('📖 读取已保存的数据');
                return data;
            }
        } catch (error) {
            console.error('❌ 读取保存数据失败:', error.message);
        }
        return null;
    }

    // 主要更新流程
    async updateData() {
        if (this.isUpdating) {
            console.log('⚠️ 更新正在进行中，跳过本次更新');
            return;
        }

        this.isUpdating = true;
        console.log('🔄 开始更新数据...');

        try {
            const accountData = await this.fetchAccountData();
            if (accountData) {
                await this.saveData(accountData);
                this.lastUpdate = Date.now();
                console.log('✅ 数据更新完成');
            } else {
                console.log('⚠️ 无法获取新数据，保持使用现有数据');
            }
        } catch (error) {
            console.error('❌ 更新过程中出错:', error.message);
        } finally {
            this.isUpdating = false;
        }
    }

    // 启动定时更新
    startScheduledUpdates() {
        console.log('🚀 启动定时数据更新服务');
        console.log(`⏰ 更新间隔: ${this.updateInterval / (60 * 60 * 1000)}小时`);
        
        // 立即执行一次更新
        this.updateData();
        
        // 设置定时更新
        setInterval(() => {
            this.updateData();
        }, this.updateInterval);
    }

    // 手动更新（用于测试）
    async manualUpdate() {
        console.log('🔄 手动更新数据...');
        await this.updateData();
    }
}

// 主程序
async function main() {
    const fetcher = new DataFetcher();
    
    // 检查命令行参数
    const args = process.argv.slice(2);
    
    if (args.includes('--manual') || args.includes('-m')) {
        // 手动更新模式
        await fetcher.manualUpdate();
        process.exit(0);
    } else if (args.includes('--once') || args.includes('-o')) {
        // 只执行一次更新
        await fetcher.updateData();
        process.exit(0);
    } else {
        // 启动定时更新服务
        fetcher.startScheduledUpdates();
        
        // 保持程序运行
        console.log('💡 按 Ctrl+C 停止服务');
        console.log('💡 使用 --manual 或 -m 参数进行手动更新');
        console.log('💡 使用 --once 或 -o 参数只执行一次更新');
    }
}

// 错误处理
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ 未处理的Promise拒绝:', reason);
});

process.on('SIGINT', () => {
    console.log('\n👋 服务已停止');
    process.exit(0);
});

// 启动程序
if (require.main === module) {
    main().catch(console.error);
}

module.exports = DataFetcher;
