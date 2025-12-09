// Simple test for system field truncation functionality
const { truncateSystemForLog, truncateMessagesForLog } = require('./src/index.ts');

// Test configuration
const config = {
  LOG_TRUNCATE_SYSTEM: true,
  LOG_SYSTEM_MAX_LENGTH: 100,
  LOG_TRUNCATE_MESSAGES: true,
  LOG_MAX_MESSAGES: 3,
  LOG_MAX_MESSAGE_LENGTH: 50
};

// Test data
const largeSystem = [
  {
    type: 'text',
    text: 'This is a very long system prompt that contains a lot of text. '.repeat(50)
  }
];

const largeMessages = [
  {
    role: 'user',
    content: 'This is a short message.'
  },
  {
    role: 'assistant', 
    content: 'This is a medium length message that has some content in it but not too much.'
  },
  {
    role: 'user',
    content: 'This is a very long message that should be truncated because it exceeds the maximum length limit. '.repeat(10)
  },
  {
    role: 'assistant',
    content: 'Another message.'
  },
  {
    role: 'user',
    content: 'Yet another message that will be omitted due to message count limit.'
  }
];

console.log('=== System Field Truncation Test ===');
console.log('Original length:', largeSystem[0].text.length);
const truncatedSystem = truncateSystemForLog(largeSystem);
console.log('Truncated length:', truncatedSystem[0].text.length);
console.log('Contains truncation marker:', truncatedSystem[0].text.includes('[SYSTEM_CONTENT_TRUNCATED_FOR_LOGGING]'));

console.log('\n=== Messages Field Truncation Test ===');
console.log('Original messages count:', largeMessages.length);
const truncatedMessages = truncateMessagesForLog(largeMessages);
console.log('Truncated messages count:', truncatedMessages.length);
console.log('Contains truncation marker:', truncatedMessages.some(msg => 
  msg.content && msg.content.includes('[MESSAGE_CONTENT_TRUNCATED]')
));
console.log('Contains omission marker:', truncatedMessages.some(msg => 
  msg.content && msg.content.includes('additional messages omitted')
));