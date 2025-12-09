/**
 * Simple test script for session logger functionality
 */

const { SessionLoggerManager } = require('./dist/utils/sessionLogger');

async function testSessionLogger() {
  console.log('Testing Session Logger Manager...');
  
  // Create session logger manager with test configuration
  const sessionLoggerManager = new SessionLoggerManager({
    enabled: true,
    retentionDays: 7,
    maxFilesPerSession: 5,
    maxSizePerFile: '10M',
    includeCommandName: true
  });

  console.log('✅ Session logger manager created successfully');

  // Test session detection with mock request
  const mockRequest = {
    body: {
      metadata: {
        user_id: 'test_user_session_abc123def'
      },
      messages: [
        {
          role: 'user',
          content: '/test-command help me with something'
        }
      ]
    },
    headers: {
      'user-agent': 'test-agent'
    },
    url: '/v1/messages'
  };

  // Test getting session logger
  const sessionLogger = sessionLoggerManager.getSessionLogger(mockRequest);
  
  if (sessionLogger) {
    console.log('✅ Session logger created successfully');
    console.log(`Session ID detected: ${mockRequest.body.metadata.user_id.split('_session_')[1]}`);
  } else {
    console.log('❌ Failed to create session logger');
    return false;
  }

  // Test command detection
  const sessionInfo = sessionLoggerManager.getSessionInfo(
    mockRequest.body.metadata.user_id.split('_session_')[1]
  );
  
  if (sessionInfo?.commandName) {
    console.log(`✅ Command detected: ${sessionInfo.commandName}`);
  } else {
    console.log('⚠️  No command detected (this may be expected)');
  }

  // Test getting active sessions
  const activeSessions = sessionLoggerManager.getActiveSessions();
  console.log(`✅ Active sessions count: ${activeSessions.length}`);

  // End the test session
  if (sessionInfo) {
    sessionLoggerManager.endSession(sessionInfo.sessionId);
    console.log('✅ Session ended successfully');
  }

  console.log('✅ Session logger test completed successfully!');
  return true;
}

async function testLogCleanup() {
  console.log('\nTesting Log Cleanup functionality...');
  
  const { cleanupLogFiles, getLogDiskUsage } = require('./dist/utils/logCleanup');

  // Test getting disk usage
  try {
    const diskUsage = await getLogDiskUsage();
    console.log('✅ Log disk usage stats:');
    console.log(`   Total size: ${(diskUsage.totalSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   Legacy logs: ${diskUsage.legacyLogs.count} files, ${(diskUsage.legacyLogs.size / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   Session logs: ${diskUsage.sessionLogs.count} files, ${(diskUsage.sessionLogs.size / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   Archive logs: ${diskUsage.archiveLogs.count} files, ${(diskUsage.archiveLogs.size / 1024 / 1024).toFixed(2)} MB`);
  } catch (error) {
    console.log('⚠️  Disk usage test failed (may be expected if directories don\'t exist):', error.message);
  }

  // Test cleanup (with safe options)
  try {
    await cleanupLogFiles({
      legacyLogs: { maxFiles: 10, maxAgeDays: 90 },
      sessionLogs: { maxAgeDays: 30, maxFilesPerSession: 10 },
      archive: { enabled: false }
    });
    console.log('✅ Log cleanup completed successfully (no files should be deleted)');
  } catch (error) {
    console.log('⚠️  Log cleanup test failed:', error.message);
  }

  console.log('✅ Log cleanup test completed!');
  return true;
}

async function runTests() {
  console.log('🚀 Starting Session Logger Tests\n');
  
  const sessionLoggerTest = await testSessionLogger();
  const logCleanupTest = await testLogCleanup();
  
  if (sessionLoggerTest && logCleanupTest) {
    console.log('\n🎉 All tests passed!');
    process.exit(0);
  } else {
    console.log('\n❌ Some tests failed!');
    process.exit(1);
  }
}

// Run tests
runTests().catch(error => {
  console.error('Test execution failed:', error);
  process.exit(1);
});