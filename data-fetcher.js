import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// 获取当前文件的目录路径（ES模块兼容）
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
const TIANWANG_DATA_FILE = path.join(__dirname, 'data', 'tianwang-data.json');
const DATA_DIR = path.join(__dirname, 'data');

class DataFetcher {
    constructor() {
        this.sessionId = null;
        this.lastUpdate = 0;
        this.updateInterval = 2 * 60 * 60 * 1000; // 2小时
        this.isUpdating = false;
        this.loginAttempts = 0;
        this.maxLoginAttempts = 3;
        this.retryDelay = 5000; // 5秒重试延迟
    }

    // 解码base64凭据
    decodeCredentials() {
        return {
            email: Buffer.from(MYFXBOOK_CONFIG.credentials.email, 'base64').toString(),
            password: Buffer.from(MYFXBOOK_CONFIG.credentials.password, 'base64').toString()
        };
    }

    // 等待指定时间
    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // 登录获取session ID
    async login(forceRefresh = false) {
        try {
            // 如果强制刷新或没有session ID，则尝试登录
            if (forceRefresh || !this.sessionId) {
                const credentials = this.decodeCredentials();
                const formData = new URLSearchParams();
                formData.append('email', credentials.email);
                formData.append('password', credentials.password);

                console.log('🔐 尝试登录MyFXBook...');
                
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
                    this.loginAttempts = 0; // 重置登录尝试次数
                    console.log('✅ 登录成功，获取到新的session ID');
                    return true;
                } else {
                    this.loginAttempts++;
                    console.error('❌ 登录失败:', data.message);
                    
                    // 检查是否是账户锁定错误
                    if (data.message.includes('Max login attempts reached')) {
                        console.error('🚫 账户暂时锁定，请稍后再试');
                        // 等待更长时间再重试
                        await this.sleep(30000); // 等待30秒
                    }
                    
                    return false;
                }
            }
            return true; // 已有有效的session ID
        } catch (error) {
            this.loginAttempts++;
            console.error('❌ 登录过程中出错:', error.message);
            return false;
        }
    }

    // 验证session ID是否有效
    async validateSession() {
        if (!this.sessionId) {
            return false;
        }

        try {
            const response = await fetch(`${MYFXBOOK_CONFIG.accountsUrl}?session=${this.sessionId}`);
            const data = await response.json();
            
            // 如果返回错误且包含session相关消息，说明session已过期
            if (data.error && (data.message.includes('session') || data.message.includes('Session'))) {
                console.log('⚠️ Session ID已过期');
                this.sessionId = null;
                return false;
            }
            
            return !data.error;
        } catch (error) {
            console.error('❌ 验证session时出错:', error.message);
            return false;
        }
    }

    // 获取WL XAU账户数据
    async fetchAccountData(retryCount = 0) {
        const maxRetries = 2;
        
        try {
            // 检查session是否有效
            if (!this.sessionId || !(await this.validateSession())) {
                console.log('⚠️ Session无效，尝试重新登录...');
                if (!(await this.login(true))) {
                    if (retryCount < maxRetries) {
                        console.log(`🔄 登录失败，${this.retryDelay/1000}秒后重试... (${retryCount + 1}/${maxRetries})`);
                        await this.sleep(this.retryDelay);
                        return await this.fetchAccountData(retryCount + 1);
                    }
                    return null;
                }
            }

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
                if (data.message.includes('session') || data.message.includes('Session')) {
                    this.sessionId = null;
                    if (retryCount < maxRetries) {
                        console.log(`🔄 Session过期，尝试重新登录... (${retryCount + 1}/${maxRetries})`);
                        await this.sleep(this.retryDelay);
                        return await this.fetchAccountData(retryCount + 1);
                    }
                }
                return null;
            }
        } catch (error) {
            console.error('❌ 获取账户数据过程中出错:', error.message);
            if (retryCount < maxRetries) {
                console.log(`🔄 网络错误，${this.retryDelay/1000}秒后重试... (${retryCount + 1}/${maxRetries})`);
                await this.sleep(this.retryDelay);
                return await this.fetchAccountData(retryCount + 1);
            }
            return null;
        }
    }

    // 获取天网系统账户数据
    async fetchTianWangData(retryCount = 0) {
        const maxRetries = 2;
        
        try {
            // 检查session是否有效
            if (!this.sessionId || !(await this.validateSession())) {
                console.log('⚠️ Session无效，尝试重新登录...');
                if (!(await this.login(true))) {
                    if (retryCount < maxRetries) {
                        console.log(`🔄 登录失败，${this.retryDelay/1000}秒后重试... (${retryCount + 1}/${maxRetries})`);
                        await this.sleep(this.retryDelay);
                        return await this.fetchTianWangData(retryCount + 1);
                    }
                    return null;
                }
            }

            // 直接使用账户ID获取天网系统数据
            const tianWangAccountId = '8800401';
            const response = await fetch(`https://www.myfxbook.com/api/get-account.json?session=${this.sessionId}&id=${tianWangAccountId}`);
            const data = await response.json();

            if (!data.error && data.account) {
                console.log('✅ 成功获取天网系统账户数据');
                return data.account;
            } else {
                console.error('❌ 获取天网系统账户数据失败:', data.message);
                
                // 如果是session过期，尝试重新登录
                if (data.message.includes('session') || data.message.includes('Session')) {
                    this.sessionId = null;
                    if (retryCount < maxRetries) {
                        console.log(`🔄 Session过期，尝试重新登录... (${retryCount + 1}/${maxRetries})`);
                        await this.sleep(this.retryDelay);
                        return await this.fetchTianWangData(retryCount + 1);
                    }
                }
                return null;
            }
        } catch (error) {
            console.error('❌ 获取天网系统账户数据过程中出错:', error.message);
            if (retryCount < maxRetries) {
                console.log(`🔄 网络错误，${this.retryDelay/1000}秒后重试... (${retryCount + 1}/${maxRetries})`);
                await this.sleep(this.retryDelay);
                return await this.fetchTianWangData(retryCount + 1);
            }
            return null;
        }
    }

    // 保存数据到文件
    async saveData(accountData, accountType = 'wl-xau') {
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

            // 根据账户类型选择保存文件
            const targetFile = accountType === 'tianwang' ? TIANWANG_DATA_FILE : DATA_FILE;
            fs.writeFileSync(targetFile, JSON.stringify(dataToSave, null, 2));
            console.log(`✅ ${accountType === 'tianwang' ? '天网系统' : 'WL XAU'}数据已保存到文件`);
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
            // 更新WL XAU账户数据
            const wlXauData = await this.fetchAccountData();
            if (wlXauData) {
                await this.saveData(wlXauData, 'wl-xau');
                console.log('✅ WL XAU数据更新完成');
            } else {
                console.log('⚠️ 无法获取WL XAU新数据，保持使用现有数据');
            }

            // 更新天网系统账户数据
            const tianWangData = await this.fetchTianWangData();
            if (tianWangData) {
                await this.saveData(tianWangData, 'tianwang');
                console.log('✅ 天网系统数据更新完成');
            } else {
                console.log('⚠️ 无法获取天网系统新数据，保持使用现有数据');
            }

            this.lastUpdate = Date.now();
            console.log('✅ 所有数据更新完成');
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
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}

export default DataFetcher;
