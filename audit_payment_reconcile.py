import json
import time
import requests
import re
from datetime import datetime
from collections import defaultdict
from sync_sheets_sa import get_access_token

TRACK_SPREADSHEET_ID = '1Lu1C-aX9KCRhCrcrZNal81tt4-wD_6wqHWqsI5orTrY'
TEST_SPREADSHEET_ID = '1BL4AhHPGPubuIh2_H29jRqR48DjclRsA1OAzTDoqsOY'
MASTER_SPREADSHEET_ID = '1aNzEsD0v92fVZtklSj79ZxDtXCkySQxw63HVlydg88g'

def normalize(val):
    if not val:
        return ''
    return re.sub(r'[\s\-_/.]', '', str(val)).upper()

def get_digits(val):
    return re.sub(r'\D', '', str(val))

def parse_num(val):
    if not val:
        return 0.0
    s = re.sub(r'[₹,\s]', '', str(val))
    try:
        return float(s)
    except:
        return 0.0

def run_reconciliation(dry_run=True):
    print("=" * 60)
    print(f"BILL AUDIT PRO - PAYMENT STATUS CHECK & RECONCILIATION")
    print(f"Mode: {'DRY RUN (Preview Only)' if dry_run else 'LIVE UPDATE'}")
    print("=" * 60)
    
    token = get_access_token()
    headers = {
        'Authorization': f'Bearer {token}',
        'Content-Type': 'application/json'
    }
    
    # 1. Fetch Master Sheet MARCH-SEPT (Cols D to P)
    print("\n1. Fetching MARCH-SEPT from Master Sheet (1aNz)...")
    url_ms = f'https://sheets.googleapis.com/v4/spreadsheets/{MASTER_SPREADSHEET_ID}/values/MARCH-SEPT!D1:P?valueRenderOption=FORMATTED_VALUE'
    ms_resp = requests.get(url_ms, headers=headers).json()
    ms_rows = ms_resp.get('values', [])
    print(f"   Loaded {len(ms_rows)} rows from MARCH-SEPT.")
    
    ms_map = {}
    for r in ms_rows[1:]:
        if not r or not r[0].strip():
            continue
        raw_inv = r[0].strip()
        norm = normalize(raw_inv)
        digits = get_digits(raw_inv)
        amt = parse_num(r[2] if len(r) > 2 else 0)
        paid_up = parse_num(r[5] if len(r) > 5 else 0)
        status = r[6].strip().upper() if len(r) > 6 else ''
        mode = r[7].strip() if len(r) > 7 else ''
        has_out = len(r) > 8 and r[8].strip() != ''
        out = parse_num(r[8] if len(r) > 8 else 0)
        receipt = r[9].strip() if len(r) > 9 else ''
        remarks = r[10].strip() if len(r) > 10 else ''
        beat = r[11].strip() if len(r) > 11 else ''
        agent = r[12].strip() if len(r) > 12 else ''
        
        info = {
            'inv': raw_inv,
            'cust': r[1] if len(r) > 1 else '',
            'amt': amt,
            'paid_up': paid_up,
            'status': status,
            'mode': mode,
            'has_out': has_out,
            'outstanding': out,
            'receipt': receipt,
            'remarks': remarks,
            'beat': beat,
            'agent': agent
        }
        ms_map[norm] = info
        if digits and len(digits) >= 4 and digits not in ms_map:
            ms_map[digits] = info

    # 2. Fetch Receipts tab (Cols A to L)
    print("\n2. Fetching Receipts Tab from Master Sheet...")
    url_rec = f'https://sheets.googleapis.com/v4/spreadsheets/{MASTER_SPREADSHEET_ID}/values/Receipts!A1:L?valueRenderOption=FORMATTED_VALUE'
    rec_resp = requests.get(url_rec, headers=headers).json()
    rec_rows = rec_resp.get('values', [])
    print(f"   Loaded {len(rec_rows)} rows from Receipts tab.")
    
    rec_map = {}
    for r in rec_rows[1:]:
        if not r or len(r) < 2 or not r[1].strip():
            continue
        raw_inv = r[1].strip()
        norm = normalize(raw_inv)
        digits = get_digits(raw_inv)
        info = {
            'date': r[0] if len(r) > 0 else '',
            'inv': raw_inv,
            'cust': r[2] if len(r) > 2 else '',
            'amt': parse_num(r[3] if len(r) > 3 else 0),
            'cash': parse_num(r[4] if len(r) > 4 else 0),
            'bank': parse_num(r[5] if len(r) > 5 else 0),
            'discount': parse_num(r[6] if len(r) > 6 else 0),
            'total_payment': parse_num(r[7] if len(r) > 7 else 0),
            'rec_no': r[8].strip() if len(r) > 8 else '',
            'remarks': r[9].strip() if len(r) > 9 else ''
        }
        rec_map[norm] = info
        if digits and len(digits) >= 4 and digits not in rec_map:
            rec_map[digits] = info

    # 3. Fetch Live_Custody from Tracking Sheet (1Lu1C)
    print("\n3. Fetching Live_Custody from Tracking Sheet (1Lu1C)...")
    url_cust = f'https://sheets.googleapis.com/v4/spreadsheets/{TRACK_SPREADSHEET_ID}/values/Live_Custody!A1:M?valueRenderOption=FORMATTED_VALUE'
    cust_resp = requests.get(url_cust, headers=headers).json()
    cust_rows = cust_resp.get('values', [])
    print(f"   Loaded {len(cust_rows)} total rows from Live_Custody.")
    
    header = cust_rows[0] if cust_rows else [
        'Invoice / Bill No', 'Party Name', 'Total Amount (₹)', 'Assigned Agent',
        'Dispatch Date', 'Current Status', 'Collected Amt (₹)', 'Remaining Due (₹)',
        'Payment Mode', 'Receipt / Ref No', 'Return Reason', 'Remarks', 'Last Updated (IST)'
    ]
    
    # Deduplicate into unique bills, keeping earliest dispatch date and latest status/timestamps
    unique_bills = {}
    for idx, r in enumerate(cust_rows[1:], 2):
        if not r or not r[0].strip():
            continue
        raw_inv = r[0].strip()
        norm = normalize(raw_inv)
        
        # Standardize invoice number with full prefix if found in Master Sheet
        m_match = ms_map.get(norm)
        if not m_match:
            digits = get_digits(raw_inv)
            if digits and len(digits) >= 4:
                m_match = ms_map.get(digits)
        standard_inv = m_match['inv'] if m_match else raw_inv
        
        existing = unique_bills.get(norm)
        
        party = r[1] if len(r) > 1 and r[1].strip() else (m_match['cust'] if m_match else 'Standard Customer')
        amt = parse_num(r[2] if len(r) > 2 else 0) or (m_match['amt'] if m_match else 0)
        agent = r[3] if len(r) > 3 and r[3].strip() else (m_match['agent'] if m_match else 'Sales Agent')
        dispatch_date = r[4] if len(r) > 4 and r[4].strip() else ''
        status = r[5].strip() if len(r) > 5 else 'WITH_AGENT'
        collected = parse_num(r[6] if len(r) > 6 else 0)
        remaining = parse_num(r[7] if len(r) > 7 else 0)
        mode = r[8] if len(r) > 8 else ''
        ref_no = r[9] if len(r) > 9 else ''
        reason = r[10] if len(r) > 10 else ''
        remarks = r[11] if len(r) > 11 else ''
        updated = r[12] if len(r) > 12 else ''
        
        if not existing:
            unique_bills[norm] = {
                'inv': standard_inv,
                'norm': norm,
                'party': party,
                'amount': amt,
                'agent': agent,
                'dispatch_date': dispatch_date,
                'status': status,
                'collected': collected,
                'remaining': remaining,
                'mode': mode,
                'ref_no': ref_no,
                'reason': reason,
                'remarks': remarks,
                'updated': updated
            }
        else:
            # Preserve earliest non-empty dispatch date
            if not existing['dispatch_date'] and dispatch_date:
                existing['dispatch_date'] = dispatch_date
            # Preserve agent if existing was generic
            if existing['agent'] in ['Shivam', 'Rajesh', 'Sales Agent'] and agent not in ['Shivam', 'Rajesh', 'Sales Agent']:
                existing['agent'] = agent
            # If any previous row was RECEIVED or PAID_FULL, preserve complete status
            if status in ['RECEIVED', 'PAID_FULL']:
                existing['status'] = status
                if collected > 0: existing['collected'] = collected
                if ref_no: existing['ref_no'] = ref_no

    print(f"   Consolidated into {len(unique_bills)} unique bills.")

    # 4. Process Payment Verification & Audit Completion
    now_ist = datetime.now().strftime('%Y-%m-%dT%H:%M:%S.000Z')
    
    completed_bills = []
    partial_bills = []
    unpaid_bills = []
    already_done_bills = []
    
    agent_stats = defaultdict(lambda: {
        'total': 0, 'completed': 0, 'completed_amt': 0.0,
        'partial': 0, 'partial_coll': 0.0, 'partial_due': 0.0,
        'unpaid': 0, 'unpaid_due': 0.0
    })
    
    reconciled_rows = []
    scan_in_logs = []
    
    for norm, b in unique_bills.items():
        inv = b['inv']
        agent = b['agent'] or 'Sales Agent'
        amt = b['amount']
        
        agent_stats[agent]['total'] += 1
        
        # Check against Master Sheet & Receipts
        m = ms_map.get(norm)
        if not m:
            digits = get_digits(inv)
            if digits and len(digits) >= 4:
                m = ms_map.get(digits)
                
        rec = rec_map.get(norm)
        if not rec:
            digits = get_digits(inv)
            if digits and len(digits) >= 4:
                rec = rec_map.get(digits)
                
        # Fill missing party/amount from Master if available
        if m:
            if not b['party'] or b['party'] == 'Standard Customer':
                b['party'] = m['cust']
            if not amt or amt == 0:
                amt = m['amt']
                b['amount'] = amt
            if not b['agent'] or b['agent'] == 'Sales Agent':
                b['agent'] = m['agent']
                agent = m['agent']

        # Determine payment details
        ms_stat = m['status'] if m else ''
        ms_out = m['outstanding'] if (m and m['has_out']) else None
        ms_paid = m['paid_up'] if m else 0.0
        ms_rec = m['receipt'] if m else ''
        ms_mode = m['mode'] if m else ''
        
        rec_no = ms_rec or (rec['rec_no'] if rec else '')
        rec_paid = rec['total_payment'] if rec else 0.0
        rec_date = rec['date'] if rec else ''
        
        # Combine payment mode
        mode_str = ms_mode
        if not mode_str:
            if rec:
                parts = []
                if rec['cash'] > 0: parts.append(f"CASH ₹{rec['cash']:,.0f}")
                if rec['bank'] > 0: parts.append(f"BANK ₹{rec['bank']:,.0f}")
                if rec['discount'] > 0: parts.append(f"DISCOUNT ₹{rec['discount']:,.0f}")
                mode_str = (rec_date + ' ' if rec_date else '') + (' + '.join(parts) if parts else 'Settled')
            else:
                mode_str = 'Cash'

        # Check full payment
        is_full_paid = False
        if ms_stat == 'PAID':
            is_full_paid = True
        elif ms_out == 0.0 and (ms_paid > 0 or rec_no):
            is_full_paid = True
        elif rec and rec_paid >= amt and amt > 0:
            is_full_paid = True

        # Check partial payment
        is_partial = False
        if not is_full_paid:
            if ms_stat == 'PARTIAL' or (rec_no and ms_out and ms_out > 0) or (ms_paid > 0 and ms_paid < amt):
                is_partial = True
            elif rec and rec_paid > 0 and rec_paid < amt:
                is_partial = True

        # Check if bill was already marked complete manually in app
        is_previously_complete = b['status'] in ['RECEIVED', 'PAID_FULL', 'RETURNED_IN_HAND']

        if is_full_paid:
            coll_amt = ms_paid if ms_paid > 0 else (rec_paid if rec_paid > 0 else amt)
            b['status'] = 'PAID_FULL'
            b['collected'] = coll_amt
            b['remaining'] = 0.0
            b['mode'] = mode_str or 'Settled in Full'
            b['ref_no'] = rec_no or 'PAID IN FULL'
            b['reason'] = 'Payment Verified in Sheet'
            b['remarks'] = f"Audit Complete: Fully paid in sheet (Receipt: {rec_no or 'Verified'}, ₹{coll_amt:,.0f})"
            b['updated'] = now_ist
            
            completed_bills.append(b)
            agent_stats[agent]['completed'] += 1
            agent_stats[agent]['completed_amt'] += coll_amt
            
            scan_in_logs.append([
                now_ist, b['inv'], agent, b['party'], amt, coll_amt, 0.0,
                b['mode'], b['ref_no'], 'PAID_FULL', 'Audit Complete', b['remarks']
            ])
            
        elif is_partial:
            coll_amt = ms_paid if ms_paid > 0 else rec_paid
            rem_due = ms_out if ms_out is not None else max(0.0, amt - coll_amt)
            b['status'] = 'PAID_PARTIAL'
            b['collected'] = coll_amt
            b['remaining'] = rem_due
            b['mode'] = mode_str or 'Partial'
            b['ref_no'] = rec_no
            b['reason'] = 'Partial Payment Verified'
            b['remarks'] = f"Audit Updated: Partial payment (Receipt: {rec_no}, Paid: ₹{coll_amt:,.0f}, Due: ₹{rem_due:,.0f})"
            b['updated'] = now_ist
            
            partial_bills.append(b)
            agent_stats[agent]['partial'] += 1
            agent_stats[agent]['partial_coll'] += coll_amt
            agent_stats[agent]['partial_due'] += rem_due
            
        elif is_previously_complete:
            already_done_bills.append(b)
            agent_stats[agent]['completed'] += 1
            agent_stats[agent]['completed_amt'] += (b['collected'] or amt)
        else:
            # Genuinely remains unpaid / with agent!
            b['status'] = 'WITH_AGENT'
            b['collected'] = 0.0
            b['remaining'] = amt
            b['remarks'] = 'Pending payment / uncollected from party'
            b['updated'] = b['updated'] or now_ist
            
            unpaid_bills.append(b)
            agent_stats[agent]['unpaid'] += 1
            agent_stats[agent]['unpaid_due'] += amt

        reconciled_rows.append([
            b['inv'],
            b['party'],
            b['amount'],
            b['agent'],
            b['dispatch_date'],
            b['status'],
            b['collected'],
            b['remaining'],
            b['mode'],
            b['ref_no'],
            b['reason'],
            b['remarks'],
            b['updated']
        ])

    # Print Detailed Audit Summary
    print("\n" + "=" * 60)
    print("AUDIT & PAYMENT STATUS RECONCILIATION SUMMARY")
    print("=" * 60)
    print(f"Total Unique Bills Tracked : {len(unique_bills):,}")
    print(f"✅ Newly Made Complete     : {len(completed_bills):,} bills (₹{sum(b['collected'] for b in completed_bills):,.2f})")
    print(f"✅ Previously Complete      : {len(already_done_bills):,} bills (₹{sum(b['collected'] or b['amount'] for b in already_done_bills):,.2f})")
    print(f"⚠️ Partial Payments Logged  : {len(partial_bills):,} bills (Collected: ₹{sum(b['collected'] for b in partial_bills):,.2f}, Due: ₹{sum(b['remaining'] for b in partial_bills):,.2f})")
    print(f"❌ Still Remain Unpaid      : {len(unpaid_bills):,} bills (Pending Due: ₹{sum(b['remaining'] for b in unpaid_bills):,.2f})")
    print("=" * 60)
    
    print("\nBREAKDOWN PER SALES AGENT:")
    for ag, st in agent_stats.items():
        print(f"\n  👤 Agent: {ag}")
        print(f"     Total Bills: {st['total']}")
        print(f"     ✅ Audit Complete (Paid) : {st['completed']} bills | Value: ₹{st['completed_amt']:,.2f}")
        print(f"     ⚠️ Partial Paid (Balance): {st['partial']} bills | Collected: ₹{st['partial_coll']:,.2f} | Remaining Due: ₹{st['partial_due']:,.2f}")
        print(f"     ❌ Remain Unpaid (In Hand): {st['unpaid']} bills | Pending Due: ₹{st['unpaid_due']:,.2f}")

    if dry_run:
        print("\n[DRY RUN COMPLETE] No changes were written to Google Sheets.")
        print("To apply live changes, pass dry_run=False.")
        return {
            'completed_count': len(completed_bills),
            'partial_count': len(partial_bills),
            'unpaid_count': len(unpaid_bills),
            'rows_to_write': len(reconciled_rows)
        }

    # ========================================================
    # 5. LIVE WRITE TO GOOGLE SHEETS
    # ========================================================
    print("\n5. Applying LIVE Updates to Google Sheets...")
    
    # 5A. Update Live_Custody in TRACKING_SPREADSHEET_ID (1Lu1C)
    print(f"   Writing {len(reconciled_rows)} clean rows to Tracking Sheet (1Lu1C) Live_Custody...")
    # Clear existing rows first
    clear_url = f'https://sheets.googleapis.com/v4/spreadsheets/{TRACK_SPREADSHEET_ID}/values/Live_Custody!A2:M:clear'
    requests.post(clear_url, headers=headers)
    
    write_cust_url = f'https://sheets.googleapis.com/v4/spreadsheets/{TRACK_SPREADSHEET_ID}/values/Live_Custody!A1?valueInputOption=USER_ENTERED'
    all_cust_data = [header] + reconciled_rows
    w_resp1 = requests.put(write_cust_url, headers=headers, json={'values': all_cust_data})
    print(f"   -> Tracking Sheet Live_Custody updated: HTTP {w_resp1.status_code}")
    
    # Append to Scan_In_Log in Tracking Sheet
    if scan_in_logs:
        print(f"   Appending {len(scan_in_logs)} audit records to Scan_In_Log...")
        append_log_url = f'https://sheets.googleapis.com/v4/spreadsheets/{TRACK_SPREADSHEET_ID}/values/Scan_In_Log!A:L:append?valueInputOption=USER_ENTERED'
        w_log_resp = requests.post(append_log_url, headers=headers, json={'values': scan_in_logs})
        print(f"   -> Scan_In_Log append: HTTP {w_log_resp.status_code}")

    # 5B. Update Live_Custody in TEST_SPREADSHEET_ID (1BL4)
    print(f"\n   Writing {len(reconciled_rows)} clean rows to Test Sheet (1BL4) Live_Custody...")
    clear_url2 = f'https://sheets.googleapis.com/v4/spreadsheets/{TEST_SPREADSHEET_ID}/values/Live_Custody!A2:M:clear'
    requests.post(clear_url2, headers=headers)
    
    write_cust_url2 = f'https://sheets.googleapis.com/v4/spreadsheets/{TEST_SPREADSHEET_ID}/values/Live_Custody!A1?valueInputOption=USER_ENTERED'
    w_resp2 = requests.put(write_cust_url2, headers=headers, json={'values': all_cust_data})
    print(f"   -> Test Sheet Live_Custody updated: HTTP {w_resp2.status_code}")

    print("\n✅ RECONCILIATION & AUDIT COMPLETION SUCCESSFULLY APPLIED!")
    return {
        'status': 'SUCCESS',
        'completed_count': len(completed_bills),
        'partial_count': len(partial_bills),
        'unpaid_count': len(unpaid_bills)
    }

if __name__ == '__main__':
    # Run in dry run first
    run_reconciliation(dry_run=True)
