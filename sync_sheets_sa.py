import json
import time
import base64
import requests
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.serialization import load_pem_private_key

SA_KEY_PATH = '/tmp/busy_sheets_sa_key.json'

def get_access_token():
    with open(SA_KEY_PATH) as f:
        sa = json.load(f)
    
    header = {"alg": "RS256", "typ": "JWT"}
    now = int(time.time())
    payload = {
        "iss": sa["client_email"],
        "scope": "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive",
        "aud": "https://oauth2.googleapis.com/token",
        "iat": now,
        "exp": now + 3600
    }
    
    def b64url(data):
        if isinstance(data, dict):
            data = json.dumps(data).encode('utf-8')
        elif isinstance(data, str):
            data = data.encode('utf-8')
        return base64.urlsafe_b64encode(data).decode('utf-8').rstrip('=')
    
    header_b64 = b64url(header)
    payload_b64 = b64url(payload)
    signing_input = f"{header_b64}.{payload_b64}".encode('utf-8')
    
    key = load_pem_private_key(sa["private_key"].encode('utf-8'), password=None)
    signature = key.sign(signing_input, padding.PKCS1v15(), hashes.SHA256())
    sig_b64 = base64.urlsafe_b64encode(signature).decode('utf-8').rstrip('=')
    
    assertion = f"{header_b64}.{payload_b64}.{sig_b64}"
    
    token_resp = requests.post("https://oauth2.googleapis.com/token", data={
        "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
        "assertion": assertion
    }, timeout=15)
    
    data = token_resp.json()
    if "access_token" not in data:
        raise RuntimeError(f"Failed to get token: {data}")
    return data["access_token"]

if __name__ == "__main__":
    token = get_access_token()
    print("Successfully obtained access token!")
    
    headers = {"Authorization": f"Bearer {token}"}
    
    # 1. Search for shared files in Google Drive
    drive_url = "https://www.googleapis.com/drive/v3/files?pageSize=20&fields=files(id,name,mimeType)"
    d_resp = requests.get(drive_url, headers=headers, timeout=15)
    print("Drive Files shared with SA:")
    for f in d_resp.json().get("files", []):
        print(f"  - {f['name']} (ID: {f['id']})")
        
    # 2. Inspect the test sheet provided by user
    TEST_SHEET_ID = "1BL4AhHPGPubuIh2_H29jRqR48DjclRsA1OAzTDoqsOY"
    sheet_meta_url = f"https://sheets.googleapis.com/v4/spreadsheets/{TEST_SHEET_ID}"
    s_resp = requests.get(sheet_meta_url, headers=headers, timeout=15)
    if s_resp.status_code == 200:
        meta = s_resp.json()
        print(f"\nTest Sheet Title: {meta.get('properties', {}).get('title')}")
        print("Sheets (Tabs):")
        for s in meta.get("sheets", []):
            sprops = s.get("properties", {})
            print(f"  - {sprops.get('title')} (ID: {sprops.get('sheetId')}, Rows: {sprops.get('gridProperties', {}).get('rowCount')}, Cols: {sprops.get('gridProperties', {}).get('columnCount')})")
    else:
        print(f"Error accessing test sheet ({s_resp.status_code}):", s_resp.text)
