import requests
from sync_sheets_sa import get_access_token

TEST_SPREADSHEET_ID = '1BL4AhHPGPubuIh2_H29jRqR48DjclRsA1OAzTDoqsOY'
token = get_access_token()
headers = {
    'Authorization': f'Bearer {token}',
    'Content-Type': 'application/json'
}

start_row = 15305
end_row = 15315
rows_to_write = []

for r in range(start_row, end_row + 1):
    f_status = f'=IF(D{r}="", "", IFERROR(VLOOKUP(D{r}, Live_Custody!$A:$F, 6, FALSE), "IN OFFICE"))'
    f_disp_date = f'=IF(D{r}="", "", IFERROR(VLOOKUP(D{r}, Live_Custody!$A:$E, 5, FALSE), ""))'
    f_agent = f'=IF(D{r}="", "", IFERROR(VLOOKUP(D{r}, Live_Custody!$A:$D, 4, FALSE), ""))'
    f_return_date = f'=IF(D{r}="", "", IFERROR(VLOOKUP(D{r}, Live_Custody!$A:$M, 13, FALSE), ""))'
    f_days = f'=IF(OR(D{r}="", X{r}<>"WITH_AGENT", Y{r}=""), 0, IFERROR(MAX(0, TODAY() - DATEVALUE(Y{r})), 0))'
    rows_to_write.append([f_status, f_disp_date, f_agent, f_return_date, f_days])

url = f'https://sheets.googleapis.com/v4/spreadsheets/{TEST_SPREADSHEET_ID}/values/MARCH-SEPT!X{start_row}:AB{end_row}?valueInputOption=USER_ENTERED'
resp = requests.put(url, headers=headers, json={'values': rows_to_write})
print('Write formulas response:', resp.status_code)

# Read back calculated values
read_url = f'https://sheets.googleapis.com/v4/spreadsheets/{TEST_SPREADSHEET_ID}/values/MARCH-SEPT!D{start_row}:AB{end_row}?valueRenderOption=FORMATTED_VALUE'
calc_rows = requests.get(read_url, headers=headers).json().get('values', [])

print('Calculated Results for Rows 15305-15315:')
for i, r in enumerate(calc_rows):
    row_num = start_row + i
    bill_no = r[0] if len(r) > 0 else ''
    status = r[-5] if len(r) >= 5 else ''
    disp_date = r[-4] if len(r) >= 4 else ''
    agent = r[-3] if len(r) >= 3 else ''
    ret_date = r[-2] if len(r) >= 2 else ''
    days = r[-1] if len(r) >= 1 else ''
    print(f'Row {row_num}: Bill={bill_no} | Status={status} | Dispatched={disp_date} | Agent={agent} | Return/Settled={ret_date} | Days={days}')
