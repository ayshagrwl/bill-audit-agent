from sync_sheets_sa import get_access_token
import requests
from collections import Counter

TEST_SPREADSHEET_ID = '1BL4AhHPGPubuIh2_H29jRqR48DjclRsA1OAzTDoqsOY'
token = get_access_token()
headers = {'Authorization': f'Bearer {token}'}

# Read Col X (Custody Status) across all rows
url = f'https://sheets.googleapis.com/v4/spreadsheets/{TEST_SPREADSHEET_ID}/values/MARCH-SEPT!X2:X?valueRenderOption=FORMATTED_VALUE'
res = requests.get(url, headers=headers).json()
statuses = [r[0] for r in res.get('values', []) if r]

counts = Counter(statuses)
print("=== CUSTODY STATUS DISTRIBUTION IN MARCH-SEPT ===")
for status, cnt in counts.most_common():
    print(f"  {status}: {cnt:,} bills")

# Read Row 7125 (the exact row user mentioned!)
r7125 = requests.get(f'https://sheets.googleapis.com/v4/spreadsheets/{TEST_SPREADSHEET_ID}/values/MARCH-SEPT!D7125:AB7125?valueRenderOption=FORMATTED_VALUE', headers=headers).json().get('values', [[]])[0]
print("\n=== USER ROW 7125 VERIFICATION ===")
print(f"  Invoice: {r7125[0]}")
print(f"  Party: {r7125[1]}")
print(f"  Col X (Status): {r7125[-5]}")
print(f"  Col Y (Dispatched Date): {r7125[-4]}")
print(f"  Col Z (Current Custodian): {r7125[-3]}")
print(f"  Col AA (Return/Settled): {r7125[-2]}")
print(f"  Col AB (Days in Field): {r7125[-1]}")

# Read Row 15306 (one of the actively scanned bills with Rajesh)
r15306 = requests.get(f'https://sheets.googleapis.com/v4/spreadsheets/{TEST_SPREADSHEET_ID}/values/MARCH-SEPT!D15306:AB15306?valueRenderOption=FORMATTED_VALUE', headers=headers).json().get('values', [[]])[0]
print("\n=== ACTIVELY SCANNED BILL ROW 15306 (Rajesh) ===")
print(f"  Invoice: {r15306[0]}")
print(f"  Party: {r15306[1]}")
print(f"  Col X (Status): {r15306[-5]}")
print(f"  Col Y (Dispatched Date): {r15306[-4]}")
print(f"  Col Z (Current Custodian): {r15306[-3]}")
print(f"  Col AA (Return/Settled): {r15306[-2]}")
print(f"  Col AB (Days in Field): {r15306[-1]}")
