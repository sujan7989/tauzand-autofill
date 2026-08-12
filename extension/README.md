# Tauzand AutoFill Assistant - Chrome Extension

A production-ready Chrome Extension (Manifest V3) for intelligent job application form auto-fill. This extension integrates with the Tauzand Form Analysis Engine and Field Mapping Engine backends to automatically detect, analyze, and fill job application forms.

## Features

### Core Functionality
- **Intelligent Form Detection**: Detects standard HTML forms, React forms, Angular forms, Vue forms, and dynamic forms
- **Backend Integration**: Connects to existing Flask backend for form analysis and field mapping
- **Confidence-Based Autofill**: Auto-fills fields with confidence ≥ 0.85, highlights lower confidence fields for review
- **Visual Feedback**: Color-coded field highlighting (green/yellow/red) with tooltips

### Form Detection
- Standard HTML forms
- Forms without `<form>` tags
- Dynamic React/Angular/Vue forms
- Lazy-loaded forms
- Multi-step forms
- Multiple forms per page

### Supported Field Types
- Text inputs
- Email fields
- Telephone fields
- URLs
- Numbers
- Textareas
- Select dropdowns
- Checkboxes
- Radio buttons
- Date fields

**Note**: File inputs are detected and highlighted but require manual upload for security reasons.

## Installation

### Chrome (Developer Mode)

1. **Download/Clone** the extension folder
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable **Developer mode** (toggle in top right)
4. Click **Load unpacked**
5. Select the `extension` directory
6. The extension icon should appear in your toolbar

### Configuration

1. Click the extension icon to open the popup
2. Go to **Settings** section
3. Set your **Backend URL** (default: `http://localhost:5000`)
4. Adjust **Confidence Threshold** if needed (default: 0.85)
5. Click **Save Settings**

## Usage

### 1. Load Your Profile

Click **Load Profile** in the popup to connect your candidate profile from the backend.

### 2. Scan Page for Forms

Click **Scan Page** to detect all forms on the current page. The extension will:
- Detect all form fields
- Send HTML to the backend for analysis
- Receive field mappings with confidence scores
- Display statistics in the popup

### 3. Autofill Forms

Click **Autofill** to automatically fill detected form fields:
- Fields with confidence ≥ 0.85 are filled automatically (green highlight)
- Fields with lower confidence are highlighted (yellow) for manual review
- Unmapped fields are highlighted (red)

### 4. Manual Review

- Yellow highlighted fields need manual review
- Red highlighted fields couldn't be mapped to your profile
- You can manually fill these fields as needed

## Architecture

```
extension/
├── manifest.json          # Manifest V3 configuration
├── background/
│   └── background.js      # Service worker - manages state and messaging
├── content/
│   ├── detectForms.js     # Form detection logic
│   ├── extractHTML.js     # HTML extraction and backend communication
│   ├── observer.js        # DOM mutation observer for dynamic forms
│   ├── messaging.js       # Inter-script communication
│   ├── autoFill.js        # Auto-fill engine
│   ├── highlighter.js     # Visual feedback and highlighting
│   └── styles.css         # Content script styles
├── popup/
│   ├── popup.html         # Popup UI
│   ├── popup.css          # Popup styles
│   └── popup.js           # Popup logic
├── api/
│   └── backend.js         # Backend communication service
├── storage/
│   └── profileStorage.js  # Profile and settings storage
├── utils/
│   ├── dom.js            # DOM utilities
│   ├── confidence.js     # Confidence score utilities
│   ├── logger.js         # Logging utilities
│   └── storage.js        # Storage utilities
├── options.html          # Options/settings page
├── options.js            # Options logic
├── README.md            # This file
└── assets/
    └── icons/            # Extension icons (16, 32, 48, 128 px)
```

## Backend Integration

The extension uses the following existing backend endpoints:

### POST /api/v1/form-analysis
Analyzes HTML forms and extracts field metadata.

**Request:**
```json
{
  "html": "<form>...</form>",
  "url": "https://example.com/job/apply",
  "pageTitle": "Job Application",
  "forms": [...]
}
```

**Response:**
```json
{
  "success": true,
  "forms": [
    {
      "form_index": 0,
      "form_id": "...",
      "elements": [...]
    }
  ]
}
```

### POST /api/v1/field-mapping
Maps form fields to candidate profile fields.

**Request:**
```json
{
  "form_analysis": { /* Output from form-analysis */ },
  "profile": { /* Candidate profile data */ }
}
```

**Response:**
```json
{
  "success": true,
  "mapping_result": {
    "mappings": [
      {
        "form_field_name": "email",
        "form_field_type": "email",
        "profile_field_name": "email",
        "confidence_score": 0.98,
        "match_type": "autocomplete",
        "mapped_value": "john@example.com"
      }
    ],
    "unmapped_form_fields": [...],
    "unmapped_profile_fields": [...],
    "ambiguous_fields": [...],
    "mapping_statistics": {...}
  }
}
```

## Configuration Options

| Setting | Default | Description |
|---------|---------|-------------|
| Backend URL | http://localhost:5000 | URL of the Flask backend |
| Confidence Threshold | 0.85 | Minimum confidence to auto-fill |
| Auto-scan | false | Automatically scan pages on load |
| Show Toasts | true | Show toast notifications |
| Highlight Fields | true | Highlight fields with colors |

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Scan Page | Detect and analyze forms |
| Autofill | Fill matched fields |

## Browser Compatibility

- Google Chrome 88+
- Microsoft Edge 88+
- Brave (latest)
- Other Chromium-based browsers

## Troubleshooting

### Backend Connection Issues
- Ensure Flask backend is running on the configured URL
- Check browser console for connection errors
- Verify CORS is enabled on the backend

### Forms Not Detected
- Some websites use custom form implementations
- Try refreshing the page
- Check if the website blocks content scripts

### Autofill Not Working
- Verify your profile is loaded
- Check confidence scores in the popup
- Some fields may require manual input
- File inputs cannot be auto-filled for security

## Development

### Testing the Extension

1. Load the extension in Chrome Developer Mode
2. Open a job application form (e.g., LinkedIn Jobs, Greenhouse, Lever)
3. Configure the backend URL if needed
4. Click "Load Profile" to load your candidate data
5. Click "Scan Page" to detect forms
6. Click "Autofill" to fill the form

### Debugging

- Open Chrome DevTools (F12) and go to the Console tab
- Content scripts run in the context of web pages
- Background script logs appear in `chrome://extensions/` → "Service Worker" link
- Popup logs appear in the popup's DevTools

## Security Considerations

- No personal data is stored in the extension (only in backend)
- File inputs cannot be auto-filled due to browser security restrictions
- Backend communication uses standard HTTPS when deployed
- Extension requires minimal permissions (storage, scripting, host access)

## License

Internal use only - Tauzand Intelligence

## Support

For issues or feature requests, contact the development team.