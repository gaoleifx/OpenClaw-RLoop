const fs = require('fs');
let content = fs.readFileSync('index.js', 'utf-8');

const oldFunc = `async function handleSessionMonitoring(config, sessionId, messages, feishuUserId) {
  const monitorState = await loadMonitorState(config);
  const isMonitored = monitorState[sessionId]?.enabled ?? false;
  const latestUserMsg = getLatestUserMessage(messages);
  if (latestUserMsg) {
    if (matchesPhrases(latestUserMsg, config.sessionMonitor.triggerPhrases)) {
      await enableSessionMonitor(config, sessionId, config.sessionMonitor.silenceThresholdMs, feishuUserId);
      if (shouldLog("info", config.logLevel)) {
        console.info(\`[rloop] Session monitor activated by trigger phrase: "\${latestUserMsg.substring(0, 50)}" (user: \${feishuUserId ?? "unknown"})\`);
      }
      return "";
    }
    if (matchesPhrases(latestUserMsg, config.sessionMonitor.deactivatePhrases)) {
      await disableSessionMonitor(config, sessionId);
      if (shouldLog("info", config.logLevel)) {
        console.info(\`[rloop] Session monitor deactivated by trigger phrase: "\${latestUserMsg.substring(0, 50)}"\`);
      }
      return "";
    }
    if (isMonitored) {
      await updateSessionLastMessage(config, sessionId);
    }
  }
  if (isMonitored) {
    const trigger = await shouldTriggerReminder(config, sessionId);
    if (trigger) {
      if (shouldLog("info", config.logLevel)) {
        console.info(\`[rloop] Session \${sessionId} silence exceeded threshold, injecting reminder\`);
      }
      return config.sessionMonitor.reminderText;
    }
  }
  return "";
}`;

const newFunc = `async function handleSessionMonitoring(config, sessionId, messages, feishuUserId) {
  const monitorState = await loadMonitorState(config);
  const isMonitored = monitorState[sessionId]?.enabled ?? false;
  const latestUserMsg = getLatestUserMessage(messages);

  if (latestUserMsg) {
    if (matchesPhrases(latestUserMsg, config.sessionMonitor.triggerPhrases)) {
      await enableSessionMonitor(config, sessionId, config.sessionMonitor.silenceThresholdMs, feishuUserId);
      if (shouldLog("info", config.logLevel)) {
        console.info(\`[rloop] Session monitor activated by trigger phrase: "\${latestUserMsg.substring(0, 50)}" (user: \${feishuUserId ?? "unknown"})\`);
      }
      await updateSessionLastMessage(config, sessionId);
      return "";
    }

    if (matchesPhrases(latestUserMsg, config.sessionMonitor.deactivatePhrases)) {
      await disableSessionMonitor(config, sessionId);
      if (shouldLog("info", config.logLevel)) {
        console.info(\`[rloop] Session monitor deactivated by trigger phrase: "\${latestUserMsg.substring(0, 50)}"\`);
      }
      return "";
    }

    if (isMonitored) {
      await updateSessionLastMessage(config, sessionId);
    }
  }

  if (isMonitored) {
    const trigger = await shouldTriggerReminder(config, sessionId);
    if (trigger) {
      if (shouldLog("info", config.logLevel)) {
        console.info(\`[rloop] Session \${sessionId} silence exceeded threshold, injecting reminder\`);
      }
      return config.sessionMonitor.reminderText;
    }
  }

  return "";
}`;

if (content.includes(oldFunc)) {
  content = content.replace(oldFunc, newFunc);
  fs.writeFileSync('index.js', content);
  console.log('Patched index.js successfully');
} else {
  console.log('OLD FUNC NOT FOUND');
  // Try to find where it is
  const idx = content.indexOf('async function handleSessionMonitoring');
  console.log('handleSessionMonitoring found at:', idx);
  // Show first 500 chars of the function
  if (idx >= 0) {
    console.log(content.substring(idx, idx + 500));
  }
}
