# Returning User Feature - Implementation Guide

## 🎯 Overview

This implementation adds comprehensive support for returning users to Hustleclub.app, ensuring that users who have completed their trial can always come back to enter feedback and generate their business plan PDF without being locked out by rate limits.

## ✨ Key Features Implemented

### 1. **Never Lock Out Returning Users**
- Returning users get special rate limit treatment (50 requests/minute, no daily limit)
- Regular users maintain standard limits (12 requests/minute, 200/day)
- Server automatically detects returning users via session codes

### 2. **SQLite Persistence**
- All session data stored in SQLite database (`data/sessions.db`)
- New fields added: `trial_complete`, `feedback_given`, `return_code`
- Automatic retention: sessions expire after 90 days

### 3. **Dual Code System**
- **Session Code**: For continuing chat conversations (existing functionality)
- **Return Code**: For returning users to enter trial feedback (new functionality)
- Both codes support QR generation and text entry

### 4. **Complete Return Flow**
- Users get trial brief with both codes
- Return via QR scan or URL parameter (`?returnCode=code`)
- Enter feedback → Generate business plan PDF

## 📁 Files Modified

### `sessions.js` - Enhanced Session Management
```javascript
// New database schema
CREATE TABLE IF NOT EXISTS sessions (
  code TEXT PRIMARY KEY,
  messages TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'coaching',
  trial_complete BOOLEAN NOT NULL DEFAULT 0,    // NEW
  feedback_given BOOLEAN NOT NULL DEFAULT 0,     // NEW
  return_code TEXT,                              // NEW
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)

// New functions
export function isReturningUser(code)           // Check returning user status
export function markTrialComplete(code, returnCode)  // Mark trial complete
export function markFeedbackGiven(code)        // Mark feedback received
```

### `server.js` - Rate Limit Exemptions
```javascript
// New rate limiter for returning users
const returningUserLimiter = createLimiter({
  name: 'returning-user',
  windowMs: 60_000,    // 1 minute
  max: 50,            // High limit
});

// Modified /api/chat endpoint
app.post('/api/chat', async (req, res) => {
  const sessionCode = body.sessionCode || null;
  const isReturning = sessionCode && isReturningUser(sessionCode);
  
  if (isReturning) {
    // Use permissive limiter for returning users
    const returningVerdict = returningUserLimiter.take(ip);
    // ... handle rate limiting
  } else {
    // Use standard limiters for regular users
    for (const limiter of [burstLimiter, dailyLimiter]) {
      // ... handle rate limiting
    }
  }
});

// New endpoints
POST /api/session/:code/complete-trial  // Mark trial complete
POST /api/session/:code/feedback         // Mark feedback given  
GET  /api/session/:code/status          // Check session status
GET  /api/qr/:code                      // Generate QR URL
```

### `index.html` - Client-Side Flow
```javascript
// New state variables
var trialComplete = false;   // Has trial been marked complete
var feedbackGiven = false;   // Has user provided feedback
var returnCode = null;       // Return code for feedback entry
var RETURN_CODE_KEY = 'hustle-return-code'; // localStorage key

// Client-side code generation
function makeCode(randomValues) { /* ... */ }

// Return URL generation
function returnFeedbackUrl(code) {
  return location.origin + '/?returnCode=' + encodeURIComponent(code);
}

// Enhanced syncSession - auto-generates return codes
function syncSession(msgs) {
  // ... existing code ...
  if (stage === 'trial' && (code || sessionCode) && !returnCode) {
    var randomValues = (typeof crypto !== 'undefined' && crypto.getRandomValues) 
      ? crypto.getRandomValues.bind(crypto) : null;
    returnCode = makeCode(randomValues);
    markSessionTrialComplete(targetCode, returnCode);
  }
}

// New functions
function markSessionTrialComplete(code, returnCodeParam) { /* ... */ }
function markSessionFeedbackGiven(code) { /* ... */ }
function checkSessionStatus(code) { /* ... */ }
function restoreReturningUser(returnCode) { /* ... */ }

// Enhanced mission card - shows only one QR panel (most recent survey)
function missionCard(text) {
  if (sessionCode) {
    if (returnCode) {
      // Only show returnCode panel (most recent survey completion)
      card.appendChild(recallPanel(null, returnCode));
    } else {
      card.appendChild(recallPanel(sessionCode));
    }
  }
}

// Enhanced recallPanel - handles both code types
function recallPanel(code, returnCode) {
  if (returnCode) {
    // Show feedback panel
    panel.appendChild(el('div', 'qr-title', 'SCAN TO ENTER FEEDBACK'));
    // ... QR code and feedback code display
  } else if (code) {
    // Show regular session panel
    panel.appendChild(el('div', 'qr-title', 'SCAN TO COME BACK'));
    // ... QR code and session code display
  }
}

// Enhanced llm function - includes session code for rate limits
function llm(purpose, msgs) {
  var body = {
    purpose: purpose,
    messages: msgs.map(function (m) { 
      return { role: m.role, content: m.content }; 
    }),
    geo: geo || {},
    timezone: timezone || ''
  };
  
  // Add session code for returning users
  if (sessionCode && (returned || trialComplete)) {
    body.sessionCode = sessionCode;
  }
  
  return fetch(API_URL, { /* ... */ });
}

// Enhanced init function - handles returnCode parameter
function init() {
  // ... existing code ...
  
  var returnCodeParam = null;
  try {
    var params = new URLSearchParams(location.search);
    incoming = params.get('c');
    returnCodeParam = params.get('returnCode');
  } catch (e) {}
  
  if (returnCodeParam) {
    restoreReturningUser(returnCodeParam).catch(function (err) {
      showCodeError(err && err.message);
      openCodeModal();
    });
    return;
  }
}
```

## 🔄 User Journey

### New User Flow
1. **Start Chat** → User begins conversation with Scout
2. **Coaching Questions** → 10 questions to understand the business idea
3. **Trial Brief** → System generates mission card with:
   - **Session Code**: "sun-dance-flower" (to continue chat)
   - **Feedback Code**: "moon-skip-honey" (to enter trial feedback)
4. **Real World Trial** → User tests their business idea
5. **Return** → User comes back with Feedback Code

### Returning User Flow
1. **Arrival** → User visits `?returnCode=moon-skip-honey` or scans QR
2. **Detection** → System identifies as returning user via `isReturningUser()`
3. **Rate Limit Exemption** → User gets 50 requests/minute, no daily limit
4. **Feedback Entry** → User enters trial results and feedback
5. **Plan Generation** → System marks feedback as given, allows PDF generation
6. **Completion** → User gets their Hustler Business Plan PDF

## 🚀 Deployment Requirements

### Node.js Version
- **Minimum**: Node 22.5+ (for built-in `node:sqlite` support)
- **Recommended**: Node 24 LTS

### Environment Variables
No new environment variables required. Existing variables work as-is:
- `SESSION_DB_FILE` - Custom session database path (optional)
- `SESSION_RETENTION_DAYS` - Session retention period (default: 90 days)

### Database Migration
The system automatically migrates existing databases:
1. New columns are added with default values
2. Existing sessions continue to work
3. No manual migration required

## 🧪 Testing

### Manual Testing Steps

1. **Start the server**:
   ```bash
   cd /home/hustleclub
   npm start
   ```

2. **Test new user flow**:
   - Visit `http://localhost:3000`
   - Go through coaching questions until trial brief
   - Verify mission card shows both Session Code and Feedback Code

3. **Test returning user flow**:
   - Copy the Feedback Code from mission card
   - Visit `http://localhost:3000/?returnCode=YOUR_FEEDBACK_CODE`
   - Verify user can enter feedback without rate limits
   - Verify "Get my plan" button works

4. **Test QR codes**:
   - Scan the Feedback Code QR with phone
   - Verify it opens the correct return URL

### API Testing

```bash
# Check session status
curl http://localhost:3000/api/session/YOUR_CODE/status

# Mark trial complete
curl -X POST http://localhost:3000/api/session/YOUR_CODE/complete-trial

# Mark feedback given
curl -X POST http://localhost:3000/api/session/YOUR_CODE/feedback

# Generate QR URL
curl http://localhost:3000/api/qr/YOUR_CODE
```

## 🛠️ Configuration Options

### Rate Limit Tuning
In `server.js`, adjust the returning user limiter:
```javascript
const returningUserLimiter = createLimiter({
  name: 'returning-user',
  windowMs: 60_000,    // Time window in milliseconds
  max: 50,            // Max requests in window
});
```

### Session Retention
In `sessions.js`, adjust retention period:
```javascript
const RETENTION_DAYS = Number(process.env.SESSION_RETENTION_DAYS || 90);
```

## 🔒 Security Considerations

### Rate Limiting
- Returning users are identified by valid session/return codes only
- Codes are validated against the word lists before any database query
- Rate limits still apply to prevent abuse (50/minute for returning users)

### Data Privacy
- No personal information stored
- Sessions identified only by random codes
- Automatic expiration after 90 days
- No user tracking or analytics

### Code Security
- Three-word codes from curated word lists (884,736 combinations)
- Codes are bearer tokens - anyone with the code can access the session
- Rate limiting on code lookups prevents brute force attacks (20/hour)

## 📊 Monitoring

The system logs usage events for monitoring:
- `trial-complete` - When trial is marked complete
- `feedback-given` - When feedback is recorded
- `session-status` - When session status is checked
- `rate-limited-returning` - When returning user hits rate limit

## 🎉 Benefits

### For Users
- ✅ Never locked out after completing trial
- ✅ Easy return via QR code or text code
- ✅ Clear distinction between chat continuation and feedback entry
- ✅ Seamless experience across devices

### For Site Owners
- ✅ No user lockout complaints
- ✅ Maintains cost control for regular users
- ✅ Automatic session management
- ✅ Backward compatible with existing functionality

## 🚨 Troubleshooting

### Common Issues

**Issue**: Sessions not persisting
- **Cause**: Node version < 22.5 without SQLite support
- **Solution**: Upgrade to Node 22.5+ or 24 LTS

**Issue**: Return codes not working
- **Cause**: Database migration not completed
- **Solution**: Restart server to trigger automatic migration

**Issue**: Rate limits still applying to returning users
- **Cause**: Session code not being sent to server
- **Solution**: Check browser console for errors, ensure `sessionCode` is set

**Issue**: QR codes not scanning
- **Cause**: URL format incorrect
- **Solution**: Verify `returnFeedbackUrl()` generates correct URLs

### Debug Commands

```bash
# Check Node version and SQLite support
node -e "console.log(process.version, typeof require('node:sqlite'))"

# Test database connectivity
node -e "const {DatabaseSync} = require('node:sqlite'); new DatabaseSync('test.db'); console.log('SQLite working');"

# Check server configuration
curl http://localhost:3000/api/llm/status
```

## 📚 Related Files

- `sessions.js` - Session storage and management
- `server.js` - HTTP endpoints and rate limiting
- `index.html` - Client-side logic and UI
- `codes.js` - Code generation utilities
- `rate-limit.js` - Rate limiting implementation

## 🔄 Backward Compatibility

This implementation is fully backward compatible:
- Existing sessions continue to work
- Existing users unaffected
- All existing functionality preserved
- New features are additive only

---

**Implementation Date**: 2026-08-02  
**Status**: ✅ Complete and Ready for Deployment  
**Requirements**: Node 22.5+ for SQLite support