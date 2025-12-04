#!/usr/bin/env node
import { run } from "./index";
import { showStatus } from "./utils/status";
import { executeCodeCommand } from "./utils/codeCommand";
import { parseStatusLineData, type StatusLineInput } from "./utils/statusline";
import {
  cleanupPidFile,
  isServiceRunning,
  getServiceInfo,
} from "./utils/processCheck";
import { runModelSelector } from "./utils/modelSelector"; // ADD THIS LINE
import { activateCommand } from "./utils/activateCommand";
import {
  generateLoginUrl,
  exchangeCode,
  getOAuthStatus,
  deleteCredentials,
} from "./utils/oauth";
import { version } from "../package.json";
import { spawn, execFile } from "child_process";
import { PID_FILE, REFERENCE_COUNT_FILE } from "./constants";
import fs, { existsSync, readFileSync } from "fs";
import { join } from "path";

/**
 * 验证URL是否安全
 */
export function validateUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    // 只允许http和https协议
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return false;
    }
    // 防止明显恶意字符
    if (url.includes('"') || url.includes("'") || url.includes('&') || url.includes('|') || url.includes(';')) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * 安全地打开默认浏览器中的URL
 * 返回成功时解决的promise，失败时拒绝的promise
 */
function openBrowser(url: string): Promise<void> {
  return new Promise(async (resolve, reject) => {
    // 首先验证URL
    if (!validateUrl(url)) {
      reject(new Error(`无效或不安全的URL: ${url}`));
      return;
    }

    const platform = process.platform;
    if (platform === "win32") {
      execFile("cmd", ["/c", "start", "", url], { timeout: 5000 }, (error) => {
        if (error) reject(error);
        else resolve();
      });
    } else if (platform === "darwin") {
      execFile("open", [url], { timeout: 5000 }, (error) => {
        if (error) reject(error);
        else resolve();
      });
    } else if (platform === "linux") {
      execFile("xdg-open", [url], { timeout: 5000 }, (error) => {
        if (error) reject(error);
        else resolve();
      });
    } else {
      reject(new Error("不支持的浏览器打开平台"));
    }
  });
}

const command = process.argv[2];

const HELP_TEXT = `
Usage: ccr [command]

Commands:
  start              Start server
  stop               Stop server
  restart            Restart server
  status             Show server status
  statusline         Integrated statusline
  code               Execute claude command
  model              Interactive model selection and configuration
  activate           Output environment variables for shell integration
  ui                 Open the web UI in browser
  login              Start OAuth login flow (opens browser)
  login <code>       Exchange authorization code for tokens
  login --status     Show OAuth status
  logout             Remove OAuth credentials
  -v, version        Show version information
  -h, help           Show help information

Example:
  ccr start
  ccr code "Write a Hello World"
  ccr model
  eval "$(ccr activate)"  # Set environment variables globally
  ccr ui
  ccr login            # Opens browser to authenticate
  ccr login abc123     # Exchange code after browser auth
`;

async function waitForService(
  timeout = 10000,
  initialDelay = 1000
): Promise<boolean> {
  // Wait for an initial period to let the service initialize
  await new Promise((resolve) => setTimeout(resolve, initialDelay));

  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    const isRunning = await isServiceRunning()
    if (isRunning) {
      // Wait for an additional short period to ensure service is fully ready
      await new Promise((resolve) => setTimeout(resolve, 500));
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

async function main() {
  const isRunning = await isServiceRunning()
  switch (command) {
    case "start":
      run();
      break;
    case "stop":
      try {
        const pidStr = readFileSync(PID_FILE, "utf-8").trim();
        const pid = parseInt(pidStr, 10);
        if (isNaN(pid) || pid <= 0) {
          throw new Error("Invalid PID in file");
        }
        process.kill(pid);
        cleanupPidFile();
        if (existsSync(REFERENCE_COUNT_FILE)) {
          try {
            fs.unlinkSync(REFERENCE_COUNT_FILE);
          } catch (e) {
            // Ignore cleanup errors
          }
        }
        console.log(
          "claude code router service has been successfully stopped."
        );
      } catch (e) {
        console.log(
          "Failed to stop the service. It may have already been stopped."
        );
        cleanupPidFile();
      }
      break;
    case "status":
      await showStatus();
      break;
    case "statusline":
      // 从stdin读取JSON输入
      let inputData = "";
      process.stdin.setEncoding("utf-8");
      process.stdin.on("readable", () => {
        let chunk;
        while ((chunk = process.stdin.read()) !== null) {
          inputData += chunk;
        }
      });

      process.stdin.on("end", async () => {
        try {
          const input: StatusLineInput = JSON.parse(inputData);
          const statusLine = await parseStatusLineData(input);
          console.log(statusLine);
        } catch (error) {
          console.error("Error parsing status line data:", error);
          process.exit(1);
        }
      });
      break;
    // ADD THIS CASE
    case "model":
      await runModelSelector();
      break;
    case "activate":
    case "env":
      await activateCommand();
      break;
    case "code":
      if (!isRunning) {
        console.log("Service not running, starting service...");
        const cliPath = join(__dirname, "cli.js");

        // 验证cliPath安全性
        if (!cliPath.startsWith(__dirname)) {
          console.error("无效的CLI路径");
          process.exit(1);
        }

        const startProcess = spawn("node", [cliPath, "start"], {
          detached: true,
          stdio: "ignore",
        });

        // let errorMessage = "";
        // startProcess.stderr?.on("data", (data) => {
        //   errorMessage += data.toString();
        // });

        startProcess.on("error", (error) => {
          console.error("Failed to start service:", error.message);
          process.exit(1);
        });

        // startProcess.on("close", (code) => {
        //   if (code !== 0 && errorMessage) {
        //     console.error("Failed to start service:", errorMessage.trim());
        //     process.exit(1);
        //   }
        // });

        startProcess.unref();

        if (await waitForService()) {
          // Join all code arguments into a single string to preserve spaces within quotes
          const codeArgs = process.argv.slice(3);
          executeCodeCommand(codeArgs);
        } else {
          console.error(
            "Service startup timeout, please manually run `ccr start` to start the service"
          );
          process.exit(1);
        }
      } else {
        // Join all code arguments into a single string to preserve spaces within quotes
        const codeArgs = process.argv.slice(3);
        executeCodeCommand(codeArgs);
      }
      break;
    case "ui":
      // Check if service is running
      if (!isRunning) {
        console.log("Service not running, starting service...");
        const cliPath = join(__dirname, "cli.js");

        // 验证cliPath安全性
        if (!cliPath.startsWith(__dirname)) {
          console.error("无效的CLI路径");
          process.exit(1);
        }

        const startProcess = spawn("node", [cliPath, "start"], {
          detached: true,
          stdio: "ignore",
        });

        startProcess.on("error", (error) => {
          console.error("Failed to start service:", error.message);
          process.exit(1);
        });

        startProcess.unref();

        if (!(await waitForService())) {
          // If service startup fails, try to start with default config
          console.log(
            "Service startup timeout, trying to start with default configuration..."
          );
          const {
            initDir,
            writeConfigFile,
            backupConfigFile,
          } = require("./utils");

          try {
            // Initialize directories
            await initDir();

            // Backup existing config file if it exists
            const backupPath = await backupConfigFile();
            if (backupPath) {
              console.log(
                `Backed up existing configuration file to ${backupPath}`
              );
            }

            // Create a minimal default config file
            await writeConfigFile({
              PORT: 3456,
              Providers: [],
              Router: {},
            });
            console.log(
              "Created minimal default configuration file at ~/.claude-code-router/config.json"
            );
            console.log(
              "Please edit this file with your actual configuration."
            );

            // Try starting the service again
            // 验证cliPath安全性
            if (!cliPath.startsWith(__dirname)) {
              console.error("无效的CLI路径");
              process.exit(1);
            }
            const restartProcess = spawn("node", [cliPath, "start"], {
              detached: true,
              stdio: "ignore",
            });

            restartProcess.on("error", (error) => {
              console.error(
                "Failed to start service with default config:",
                error.message
              );
              process.exit(1);
            });

            restartProcess.unref();

            if (!(await waitForService(15000))) {
              // Wait a bit longer for the first start
              console.error(
                "Service startup still failing. Please manually run `ccr start` to start the service and check the logs."
              );
              process.exit(1);
            }
          } catch (error: any) {
            console.error(
              "Failed to create default configuration:",
              error.message
            );
            process.exit(1);
          }
        }
      }

      // Get service info and open UI
      const serviceInfo = await getServiceInfo();

      // Add temporary API key as URL parameter if successfully generated
      const uiUrl = `${serviceInfo.endpoint}/ui/`;

      console.log(`Opening UI at ${uiUrl}`);

      // Open URL in browser (await to ensure proper exit code)
      try {
        await openBrowser(uiUrl);
      } catch (error: any) {
        console.error("Failed to open browser:", error.message);
        process.exit(1);
      }
      break;
    case "login":
      const loginArg = process.argv[3];
      if (loginArg === "--status") {
        // Show OAuth status
        const status = getOAuthStatus();
        if (!status.hasCredentials) {
          console.log("OAuth: Not logged in");
          console.log("Run 'ccr login' to authenticate.");
        } else {
          console.log("OAuth: Logged in");
          if (status.expiresAt != null) {
            console.log(`Expires: ${new Date(status.expiresAt).toLocaleString()}`);
          }
          console.log(`Status: ${status.isExpired ? "Expired (will auto-refresh)" : "Valid"}`);
        }
      } else if (loginArg) {
        // Exchange authorization code
        console.log("Exchanging authorization code...");
        const credentials = await exchangeCode(loginArg);
        if (credentials) {
          console.log("✅ OAuth login successful!");
          console.log(`Token expires: ${new Date(credentials.expiresAt).toLocaleString()}`);
        } else {
          console.error("❌ OAuth login failed. Please try again.");
          process.exit(1);
        }
      } else {
        // Generate login URL and open browser
        const { url } = generateLoginUrl();
        console.log("\n🔐 OAuth Login\n");
        console.log("Opening browser for authentication...\n");
        console.log("If browser doesn't open, visit this URL:");
        console.log(url);
        console.log("\nAfter authorizing, you'll be redirected to a page showing an authorization code.");
        console.log("Run: ccr login <code>\n");

        // Open browser (don't exit on failure, user can manually visit URL)
        try {
          await openBrowser(url);
        } catch {
          console.log("Could not open browser automatically.");
        }
      }
      break;
    case "logout":
      deleteCredentials();
      console.log("✅ OAuth credentials removed.");
      break;
    case "-v":
    case "version":
      console.log(`claude-code-router version: ${version}`);
      break;
    case "restart":
      // Stop the service if it's running
      try {
        const restartPidStr = readFileSync(PID_FILE, "utf-8").trim();
        const restartPid = parseInt(restartPidStr, 10);
        if (isNaN(restartPid) || restartPid <= 0) {
          throw new Error("Invalid PID in file");
        }
        process.kill(restartPid);
        cleanupPidFile();
        if (existsSync(REFERENCE_COUNT_FILE)) {
          try {
            fs.unlinkSync(REFERENCE_COUNT_FILE);
          } catch (e) {
            // Ignore cleanup errors
          }
        }
        console.log("claude code router service has been stopped.");
      } catch (e) {
        console.log("Service was not running or failed to stop.");
        cleanupPidFile();
      }

      // Start the service again in the background
      console.log("Starting claude code router service...");
      const cliPath = join(__dirname, "cli.js");

      // 验证cliPath安全性
      if (!cliPath.startsWith(__dirname)) {
        console.error("无效的CLI路径");
        process.exit(1);
      }

      const startProcess = spawn("node", [cliPath, "start"], {
        detached: true,
        stdio: "ignore",
      });

      startProcess.on("error", (error) => {
        console.error("Failed to start service:", error);
        process.exit(1);
      });

      startProcess.unref();
      console.log("✅ Service started successfully in the background.");
      break;
    case "-h":
    case "help":
      console.log(HELP_TEXT);
      break;
    default:
      console.log(HELP_TEXT);
      process.exit(1);
  }
}

// 只在直接运行此文件时执行main，不在导入时执行
if (require.main === module) {
  main().catch(console.error);
}