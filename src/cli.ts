#!/usr/bin/env node

import { Command } from 'commander';
import { openAppleDeveloperPortal, getTargetUrl, getMapKitToken, refreshMapKitToken } from './browser.js';
import { loadConfig } from './config.js';
import { writeTokenFile } from './results.js';
import path from 'path';
import { startServer } from './server.js';

const program = new Command();

program
  .name('mapkit-token-fetcher')
  .description('自动刷新 Apple MapKit Server Token 的命令行工具')
  .version('1.0.0');

// open 命令 - 打开浏览器跳转到苹果开发者后台
program
  .command('open')
  .description('打开浏览器并跳转到 Apple Developer 后台的 MapKit Token 页面')
  .option('--headless', '使用无头模式（不显示浏览器界面）', false)
  .action(async (options) => {
    try {
      printBanner();
      console.log(`📎 目标地址: ${getTargetUrl()}`);
      console.log('');
      
      await openAppleDeveloperPortal(options.headless);
    } catch (error) {
      console.error('❌ 发生错误:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// get 命令 - 登录并获取现有 Token
program
  .command('get')
  .description('登录 Apple Developer 后台并获取现有 MapKit Token')
  .option('-o, --out <path>', '将 Token 输出到指定文件路径')
  .option('--headless', '使用无头模式（不显示浏览器界面）', false)
  .option('--no-auth-cache', '不使用缓存的登录状态（强制重新登录）')
  .action(async (options) => {
    try {
      printBanner();
      console.log('📋 功能: 登录并获取现有 MapKit Token');
      console.log('');

      // 从配置文件读取凭证
      const config = loadConfig();
      const { username, password } = config.apple;

      console.log(`📧 Apple ID: ${username}`);
      console.log(`🔑 密码: ${'*'.repeat(password.length)}`);
      console.log('');
      
      // 执行获取
      const result = await getMapKitToken(username, password, options.headless, options.authCache);
      
      const { token, warnings, cleanup } = result;
      console.log(token);
      console.log(`🧹 清理：扫描 ${cleanup.scanned}，过期 ${cleanup.expired}，撤销 ${cleanup.revoked}，失败 ${cleanup.failed}，跳过 ${cleanup.skipped}`);
      for (const warning of warnings) console.warn(`⚠️ ${warning}`);
      if (token) {
        // Token 和清理结果已输出
        
        // 如果指定了输出路径，则写入文件
        if (options.out) {
          const outputPath = path.resolve(options.out);
          await writeTokenFile(outputPath, token);
          console.log(`📄 Token 已保存到: ${outputPath}`);
        }
        
        process.exit(0);
      } else {
        process.exit(1);
      }

    } catch (error) {
      console.error('❌ 发生错误:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// refresh 命令 - 登录并创建新 Token
program
  .command('refresh')
  .description('登录 Apple Developer 后台并创建新的 MapKit Token')
  .option('-o, --out <path>', '将 Token 输出到指定文件路径')
  .option('--headless', '使用无头模式（不显示浏览器界面）', false)
  .option('--no-auth-cache', '不使用缓存的登录状态（强制重新登录）')
  .action(async (options) => {
    try {
      printBanner();
      console.log('📋 功能: 登录并创建新的 MapKit Token');
      console.log('');

      // 从配置文件读取凭证
      const config = loadConfig();
      const { username, password } = config.apple;

      console.log(`📧 Apple ID: ${username}`);
      console.log(`🔑 密码: ${'*'.repeat(password.length)}`);
      console.log('');
      
      // 执行刷新
      const result = await refreshMapKitToken(username, password, options.headless, options.authCache);
      
      const { token, warnings, cleanup } = result;
      console.log(token);
      console.log(`🧹 清理：扫描 ${cleanup.scanned}，过期 ${cleanup.expired}，撤销 ${cleanup.revoked}，失败 ${cleanup.failed}，跳过 ${cleanup.skipped}`);
      for (const warning of warnings) console.warn(`⚠️ ${warning}`);
      if (token) {
        // Token 和清理结果已输出
        
        // 如果指定了输出路径，则写入文件
        if (options.out) {
          const outputPath = path.resolve(options.out);
          await writeTokenFile(outputPath, token);
          console.log(`📄 Token 已保存到: ${outputPath}`);
        }
        
        process.exit(0);
      } else {
        process.exit(1);
      }

    } catch (error) {
      console.error('❌ 发生错误:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

/**
 * 打印工具 Banner
 */
function printBanner(): void {
  console.log('');
  console.log('🍎 MapKit Token Refresh Tool');
  console.log('═══════════════════════════════════════');
}

// serve 命令 - 启动 HTTP Server
program
  .command('serve')
  .description('启动 HTTP Server 模式，支持远程验证码输入和 Webhook 通知')
  .option('-p, --port <port>', '服务端口', '3010')
  .option('-o, --out <path>', '将 Token 输出到指定文件路径')
  .option('--headless', '使用无头模式（默认: true）', true)
  .option('--no-headless', '不使用无头模式')
  .option('--no-auth-cache', '不使用缓存的登录状态（强制重新登录）')
  .action(async (options) => {
    try {
      printBanner();
      console.log('📋 功能: HTTP Server 模式');
      console.log('');

      startServer({
        port: parseInt(options.port, 10),
        headless: options.headless,
        authCache: options.authCache,
        out: options.out
      });
    } catch (error) {
      console.error('❌ 发生错误:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program.parse();

