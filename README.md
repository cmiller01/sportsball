# GameChanger Pitch Count Extractor

A Chrome extension that extracts pitcher and catcher stats from [GameChanger](https://gc.com) game pages for youth baseball league reporting.

## What it does

While browsing a GameChanger game page, the extension automatically captures play-by-play and boxscore data in the background. Open the extension popup to see:

- **Pitchers** — innings pitched, total pitch count, and pitch count at the start of their last at-bat
- **Catchers** — positions played and estimated innings caught

Pitch counts are color-coded using Little League thresholds. Data can be exported as CSV or plain text.

## Installation

1. Clone or download this repo
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (top right toggle)
4. Click **Load unpacked** and select the `chrome-extension/` folder

## Usage

1. Navigate to any game page on `gc.com` or `gamechanger.io`
2. Browse to the play-by-play and boxscore tabs so the extension can capture the data
3. Click the extension icon to view pitcher and catcher stats
4. Use **Copy CSV** or **Copy Text** to export for reporting
