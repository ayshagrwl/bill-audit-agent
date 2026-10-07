import time
import requests
from sync_sheets_sa import get_access_token

TEST_SPREADSHEET_ID = '1BL4AhHPGPubuIh2_H29jRqR48DjclRsA1OAzTDoqsOY'
MARCH_SEPT_GID = 1608276684

def apply_all():
    token = get_access_token()
    headers = {
        'Authorization': f'Bearer {token}',
        'Content-Type': 'application/json'
    }
    
    print("1. Reading row count of MARCH-SEPT...")
    meta_url = f'https://sheets.googleapis.com/v4/spreadsheets/{TEST_SPREADSHEET_ID}'
    meta = requests.get(meta_url, headers=headers).json()
    march_sheet = next(s for s in meta['sheets'] if s['properties']['sheetId'] == MARCH_SEPT_GID)
    total_rows = march_sheet['properties']['gridProperties']['rowCount']
    print(f"   Total rows in sheet: {total_rows}")
    
    # Update headers
    print("2. Formatting Row 1 Headers (Cols X to AB)...")
    headers_to_write = [
        'Custody Status',
        'Dispatched Date',
        'Current Custodian',
        'Return / Settled Timestamp',
        'Days in Field'
    ]
    h_url = f'https://sheets.googleapis.com/v4/spreadsheets/{TEST_SPREADSHEET_ID}/values/MARCH-SEPT!X1:AB1?valueInputOption=USER_ENTERED'
    requests.put(h_url, headers=headers, json={'values': [headers_to_write]})
    
    # Generate formulas for all rows in chunks of 5,000
    chunk_size = 4000
    print(f"3. Writing lookup formulas across rows 2 to {total_rows} in chunks of {chunk_size}...")
    
    for start_r in range(2, total_rows + 1, chunk_size):
        end_r = min(start_r + chunk_size - 1, total_rows)
        chunk_values = []
        for r in range(start_r, end_r + 1):
            f_status = f'=IF(D{r}="", "", IFERROR(VLOOKUP(D{r}, Live_Custody!$A:$F, 6, FALSE), "IN OFFICE"))'
            f_disp_date = f'=IF(D{r}="", "", IFERROR(VLOOKUP(D{r}, Live_Custody!$A:$E, 5, FALSE), ""))'
            f_agent = f'=IF(D{r}="", "", IFERROR(VLOOKUP(D{r}, Live_Custody!$A:$D, 4, FALSE), ""))'
            f_return_date = f'=IF(D{r}="", "", IFERROR(VLOOKUP(D{r}, Live_Custody!$A:$M, 13, FALSE), ""))'
            f_days = f'=IF(OR(D{r}="", X{r}<>"WITH_AGENT", Y{r}=""), 0, IFERROR(MAX(0, INT(TODAY() - DATEVALUE(TEXT(Y{r}, "YYYY-MM-DD")))), 0))'
            chunk_values.append([f_status, f_disp_date, f_agent, f_return_date, f_days])
            
        chunk_url = f'https://sheets.googleapis.com/v4/spreadsheets/{TEST_SPREADSHEET_ID}/values/MARCH-SEPT!X{start_r}:AB{end_r}?valueInputOption=USER_ENTERED'
        c_resp = requests.put(chunk_url, headers=headers, json={'values': chunk_values})
        print(f"   Rows {start_r} to {end_r} written: HTTP {c_resp.status_code}")
        time.sleep(0.5)

    # 4. Format columns: Header style, Date format for Col Y, Number format for Col AB
    print("4. Applying formatting and column widths...")
    format_requests = [
        # Format Header row X1:AB1
        {
            'repeatCell': {
                'range': {
                    'sheetId': MARCH_SEPT_GID,
                    'startRowIndex': 0,
                    'endRowIndex': 1,
                    'startColumnIndex': 23,
                    'endColumnIndex': 28
                },
                'cell': {
                    'userEnteredFormat': {
                        'backgroundColor': {'red': 0.12, 'green': 0.35, 'blue': 0.60},
                        'textFormat': {'foregroundColor': {'red': 1.0, 'green': 1.0, 'blue': 1.0}, 'bold': True, 'fontSize': 10},
                        'horizontalAlignment': 'CENTER',
                        'verticalAlignment': 'MIDDLE'
                    }
                },
                'fields': 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)'
            }
        },
        # Format Col Y (Dispatched Date) as yyyy-mm-dd
        {
            'repeatCell': {
                'range': {
                    'sheetId': MARCH_SEPT_GID,
                    'startRowIndex': 1,
                    'endRowIndex': total_rows,
                    'startColumnIndex': 24,
                    'endColumnIndex': 25
                },
                'cell': {
                    'userEnteredFormat': {
                        'numberFormat': {'type': 'DATE', 'pattern': 'yyyy-mm-dd'},
                        'horizontalAlignment': 'CENTER'
                    }
                },
                'fields': 'userEnteredFormat(numberFormat,horizontalAlignment)'
            }
        },
        # Format Col X (Status) centered
        {
            'repeatCell': {
                'range': {
                    'sheetId': MARCH_SEPT_GID,
                    'startRowIndex': 1,
                    'endRowIndex': total_rows,
                    'startColumnIndex': 23,
                    'endColumnIndex': 24
                },
                'cell': {
                    'userEnteredFormat': {
                        'horizontalAlignment': 'CENTER'
                    }
                },
                'fields': 'userEnteredFormat.horizontalAlignment'
            }
        },
        # Format Col AB (Days) as integer centered
        {
            'repeatCell': {
                'range': {
                    'sheetId': MARCH_SEPT_GID,
                    'startRowIndex': 1,
                    'endRowIndex': total_rows,
                    'startColumnIndex': 27,
                    'endColumnIndex': 28
                },
                'cell': {
                    'userEnteredFormat': {
                        'numberFormat': {'type': 'NUMBER', 'pattern': '0" days"'},
                        'horizontalAlignment': 'CENTER'
                    }
                },
                'fields': 'userEnteredFormat(numberFormat,horizontalAlignment)'
            }
        }
    ]
    
    b_url = f'https://sheets.googleapis.com/v4/spreadsheets/{TEST_SPREADSHEET_ID}:batchUpdate'
    b_resp = requests.post(b_url, headers=headers, json={'requests': format_requests})
    print("   Formatting batchUpdate result:", b_resp.status_code)
    print("\nSUCCESS: All rows and formatting applied to Test Sheet!")

if __name__ == '__main__':
    apply_all()
