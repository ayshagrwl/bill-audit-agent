import json
import time
import requests
from sync_sheets_sa import get_access_token

TEST_SPREADSHEET_ID = '1BL4AhHPGPubuIh2_H29jRqR48DjclRsA1OAzTDoqsOY'
TRACKING_SPREADSHEET_ID = '1Lu1C-aX9KCRhCrcrZNal81tt4-wD_6wqHWqsI5orTrY'
MARCH_SEPT_GID = 1608276684

def run():
    token = get_access_token()
    headers = {
        'Authorization': f'Bearer {token}',
        'Content-Type': 'application/json'
    }
    
    # 1. Fetch all rows from Tracking Sheet Live_Custody
    print("1. Fetching data from Tracking Sheet Live_Custody...")
    cust_url = f'https://sheets.googleapis.com/v4/spreadsheets/{TRACKING_SPREADSHEET_ID}/values/Live_Custody!A1:M'
    r_cust = requests.get(cust_url, headers=headers)
    cust_data = r_cust.json().get('values', [])
    print(f"   Fetched {len(cust_data)} rows from Live_Custody.")
    
    # 2. Check if Live_Custody tab exists in Test Sheet
    print("2. Checking sheets in Test Spreadsheet...")
    meta_url = f'https://sheets.googleapis.com/v4/spreadsheets/{TEST_SPREADSHEET_ID}'
    meta = requests.get(meta_url, headers=headers).json()
    
    sheet_names = {s['properties']['title']: s['properties']['sheetId'] for s in meta['sheets']}
    requests_body = []
    
    if 'Live_Custody' not in sheet_names:
        print("   Adding 'Live_Custody' tab to Test Spreadsheet...")
        requests_body.append({
            'addSheet': {
                'properties': {
                    'title': 'Live_Custody',
                    'gridProperties': {
                        'rowCount': max(len(cust_data) + 100, 2000),
                        'columnCount': 15
                    }
                }
            }
        })
    else:
        print("   'Live_Custody' tab already exists.")
        
    # Check column count of MARCH-SEPT
    march_sheet = next(s for s in meta['sheets'] if s['properties']['sheetId'] == MARCH_SEPT_GID)
    cur_cols = march_sheet['properties']['gridProperties']['columnCount']
    total_rows = march_sheet['properties']['gridProperties']['rowCount']
    print(f"   MARCH-SEPT has {cur_cols} columns and {total_rows} rows.")
    
    if cur_cols < 29:
        print("   Expanding MARCH-SEPT columns from 24 to 29...")
        requests_body.append({
            'updateSheetProperties': {
                'properties': {
                    'sheetId': MARCH_SEPT_GID,
                    'gridProperties': {
                        'columnCount': 29
                    }
                },
                'fields': 'gridProperties.columnCount'
            }
        })
        
    if requests_body:
        b_url = f'https://sheets.googleapis.com/v4/spreadsheets/{TEST_SPREADSHEET_ID}:batchUpdate'
        resp = requests.post(b_url, headers=headers, json={'requests': requests_body})
        print("   BatchUpdate result:", resp.status_code)
        
    # 3. Populate Live_Custody tab with tracking data
    print("3. Writing tracking data to Live_Custody tab...")
    write_cust_url = f'https://sheets.googleapis.com/v4/spreadsheets/{TEST_SPREADSHEET_ID}/values/Live_Custody!A1?valueInputOption=USER_ENTERED'
    w_resp = requests.put(write_cust_url, headers=headers, json={'values': cust_data})
    print("   Live_Custody write result:", w_resp.status_code)
    
    # 4. Set Headers in MARCH-SEPT Row 1 (Cols X to AB)
    print("4. Updating Headers in MARCH-SEPT (Cols X to AB)...")
    headers_to_write = [
        'Custody Status',
        'Dispatched Date',
        'Current Custodian',
        'Return / Settled Date',
        'Days in Field'
    ]
    h_url = f'https://sheets.googleapis.com/v4/spreadsheets/{TEST_SPREADSHEET_ID}/values/MARCH-SEPT!X1:AB1?valueInputOption=USER_ENTERED'
    h_resp = requests.put(h_url, headers=headers, json={'values': [headers_to_write]})
    print("   Headers update result:", h_resp.status_code)

if __name__ == '__main__':
    run()
