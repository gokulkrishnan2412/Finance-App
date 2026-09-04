from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import json
import os
from datetime import datetime, timedelta

app = Flask(__name__)
CORS(app)  # Enable CORS for frontend requests

# Keep the simple list API, but persist it so a Flask restart does not erase data.
DATA_FILE = os.path.join(os.path.dirname(__file__), "lendings.json")
LOANS_DATA_FILE = os.path.join(os.path.dirname(__file__), "loans.json")
CHITS_DATA_FILE = os.path.join(os.path.dirname(__file__), "chits.json")


def load_lendings():
    try:
        with open(DATA_FILE, "r", encoding="utf-8") as file:
            data = json.load(file)
            return data if isinstance(data, list) else []
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def save_lendings():
    temporary_file = f"{DATA_FILE}.tmp"
    with open(temporary_file, "w", encoding="utf-8") as file:
        json.dump(lendings, file, indent=2)
    os.replace(temporary_file, DATA_FILE)


lendings = load_lendings()


def load_loans():
    try:
        with open(LOANS_DATA_FILE, "r", encoding="utf-8") as file:
            data = json.load(file)
            return data if isinstance(data, list) else []
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def save_loans():
    temporary_file = f"{LOANS_DATA_FILE}.tmp"
    with open(temporary_file, "w", encoding="utf-8") as file:
        json.dump(loans, file, indent=2)
    os.replace(temporary_file, LOANS_DATA_FILE)


loans = load_loans()


def load_chits():
    try:
        with open(CHITS_DATA_FILE, "r", encoding="utf-8") as file:
            data = json.load(file)
            return data if isinstance(data, list) else []
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def save_chits():
    temporary_file = f"{CHITS_DATA_FILE}.tmp"
    with open(temporary_file, "w", encoding="utf-8") as file:
        json.dump(chits, file, indent=2)
    os.replace(temporary_file, CHITS_DATA_FILE)


chits = load_chits()

@app.route("/")
def index():
    return send_from_directory("../frontend", "index.html")

@app.route("/<path:path>")
def static_files(path):
    return send_from_directory("../frontend", path)

# ============ LENDING ENDPOINTS ============

@app.route("/add_lending", methods=["POST"])
def add_lending():
    try:
        data = request.get_json()
        if not isinstance(data, dict):
            return jsonify({"status": "error", "message": "JSON object required"}), 400

        required_fields = ["name", "date", "principalAmount", "returnAmount", "type"]
        missing_fields = [field for field in required_fields if not data.get(field)]
        if missing_fields:
            return jsonify({
                "status": "error",
                "message": f"Missing fields: {', '.join(missing_fields)}"
            }), 400

        # Convert string ID to string format
        lending_id = str(data.get('id', len(lendings)))
        data['id'] = lending_id

        lendings.append(data)
        save_lendings()
        return jsonify({"status": "success", "lending": data}), 201
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400

@app.route("/get_lendings", methods=["GET"])
def get_lendings():
    return jsonify(lendings)

@app.route("/record_payment/<lending_id>", methods=["POST"])
def record_payment(lending_id):
    try:
        data = request.get_json()
        amount = float(data.get('amount', 0))
        payment_date = data.get('date', datetime.now().strftime('%Y-%m-%d'))

        # Find the lending
        lending = None
        for lend in lendings:
            if str(lend.get('id')) == str(lending_id):
                lending = lend
                break

        if not lending:
            return jsonify({"status": "error", "message": "Lending not found"}), 404

        # Update received amount
        lending['received'] = lending.get('received', 0) + amount

        # Add payment to history
        if 'payments' not in lending:
            lending['payments'] = []

        lending['payments'].append({
            'date': payment_date,
            'amount': amount
        })

        # Update schedule items
        remaining_to_pay = amount
        if 'schedule' in lending:
            for schedule_item in lending['schedule']:
                if not schedule_item.get('received') and remaining_to_pay > 0:
                    item_amount = schedule_item.get('amount', 0)
                    if remaining_to_pay >= item_amount:
                        schedule_item['received'] = True
                        schedule_item['receivedDate'] = payment_date
                        schedule_item['receivedAmount'] = item_amount
                        remaining_to_pay -= item_amount
                    else:
                        schedule_item['receivedAmount'] = schedule_item.get('receivedAmount', 0) + remaining_to_pay
                        remaining_to_pay = 0

        # Check if lending is completed
        if lending['received'] >= lending['returnAmount']:
            lending['status'] = 'completed'

        save_lendings()
        return jsonify({"status": "success", "lending": lending}), 200
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400

@app.route("/delete_lending/<lending_id>", methods=["DELETE"])
def delete_lending(lending_id):
    try:
        global lendings
        lendings = [l for l in lendings if str(l.get('id')) != str(lending_id)]
        save_lendings()
        return jsonify({"status": "success"}), 200
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400

@app.route("/close_lending/<lending_id>", methods=["POST"])
def close_lending(lending_id):
    try:
        lending = next((item for item in lendings if str(item.get("id")) == str(lending_id)), None)
        if not lending:
            return jsonify({"status": "error", "message": "Lending not found"}), 404

        lending["status"] = "closed"
        lending["closedAt"] = datetime.now().isoformat()
        save_lendings()
        return jsonify({"status": "success", "lending": lending}), 200
    except Exception as error:
        return jsonify({"status": "error", "message": str(error)}), 400

@app.route("/reopen_lending/<lending_id>", methods=["POST"])
def reopen_lending(lending_id):
    try:
        lending = next((item for item in lendings if str(item.get("id")) == str(lending_id)), None)
        if not lending:
            return jsonify({"status": "error", "message": "Lending not found"}), 404

        lending["status"] = "active"
        lending.pop("closedAt", None)
        save_lendings()
        return jsonify({"status": "success", "lending": lending}), 200
    except Exception as error:
        return jsonify({"status": "error", "message": str(error)}), 400

@app.route("/clear_all", methods=["POST"])
def clear_all():
    try:
        global lendings
        lendings = []
        save_lendings()
        loans.clear()
        save_loans()
        chits.clear()
        save_chits()
        return jsonify({"status": "success"}), 200
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400

# ============ LOAN ENDPOINTS ============

@app.route("/add_loan", methods=["POST"])
def add_loan():
    try:
        data = request.get_json()
        if not isinstance(data, dict):
            return jsonify({"status": "error", "message": "JSON object required"}), 400

        required_fields = ["bankName", "date", "loanAmount", "monthlyInterest"]
        missing_fields = [field for field in required_fields if data.get(field) in (None, "")]
        if missing_fields:
            return jsonify({
                "status": "error",
                "message": f"Missing fields: {', '.join(missing_fields)}"
            }), 400

        loan = {
            "id": str(data.get("id", datetime.now().timestamp())),
            "bankName": str(data["bankName"]).strip(),
            "date": data["date"],
            "loanAmount": float(data["loanAmount"]),
            "monthlyInterest": float(data["monthlyInterest"]),
            "notes": data.get("notes", ""),
            "interestPayments": [],
            "createdAt": datetime.now().isoformat()
        }
        loans.append(loan)
        save_loans()
        return jsonify({"status": "success", "loan": loan}), 201
    except (TypeError, ValueError, KeyError) as error:
        return jsonify({"status": "error", "message": str(error)}), 400


@app.route("/get_loans", methods=["GET"])
def get_loans():
    return jsonify(loans)


@app.route("/record_loan_interest/<loan_id>", methods=["POST"])
def record_loan_interest(loan_id):
    try:
        data = request.get_json() or {}
        amount = float(data.get("amount", 0))
        payment_date = data.get("date", datetime.now().strftime("%Y-%m-%d"))
        if amount <= 0 or not payment_date:
            return jsonify({"status": "error", "message": "A positive amount and date are required"}), 400

        loan = next((item for item in loans if str(item.get("id")) == str(loan_id)), None)
        if not loan:
            return jsonify({"status": "error", "message": "Loan not found"}), 404

        loan.setdefault("interestPayments", []).append({"date": payment_date, "amount": amount})
        save_loans()
        return jsonify({"status": "success", "loan": loan}), 200
    except (TypeError, ValueError) as error:
        return jsonify({"status": "error", "message": str(error)}), 400


@app.route("/delete_loan/<loan_id>", methods=["DELETE"])
def delete_loan(loan_id):
    try:
        original_count = len(loans)
        loans[:] = [loan for loan in loans if str(loan.get("id")) != str(loan_id)]
        if len(loans) == original_count:
            return jsonify({"status": "error", "message": "Loan not found"}), 404
        save_loans()
        return jsonify({"status": "success"}), 200
    except Exception as error:
        return jsonify({"status": "error", "message": str(error)}), 400

@app.route("/close_loan/<loan_id>", methods=["POST"])
def close_loan(loan_id):
    try:
        loan = next((item for item in loans if str(item.get("id")) == str(loan_id)), None)
        if not loan:
            return jsonify({"status": "error", "message": "Loan not found"}), 404
        loan["status"] = "closed"
        loan["closedAt"] = datetime.now().isoformat()
        save_loans()
        return jsonify({"status": "success", "loan": loan}), 200
    except Exception as error:
        return jsonify({"status": "error", "message": str(error)}), 400

@app.route("/reopen_loan/<loan_id>", methods=["POST"])
def reopen_loan(loan_id):
    try:
        loan = next((item for item in loans if str(item.get("id")) == str(loan_id)), None)
        if not loan:
            return jsonify({"status": "error", "message": "Loan not found"}), 404
        loan["status"] = "active"
        loan.pop("closedAt", None)
        save_loans()
        return jsonify({"status": "success", "loan": loan}), 200
    except Exception as error:
        return jsonify({"status": "error", "message": str(error)}), 400

# ============ CHIT ENDPOINTS ============

@app.route("/add_chit", methods=["POST"])
def add_chit():
    try:
        data = request.get_json()
        if not isinstance(data, dict):
            return jsonify({"status": "error", "message": "JSON object required"}), 400

        required_fields = ["personName", "chitAmount"]
        missing_fields = [field for field in required_fields if data.get(field) in (None, "")]
        if missing_fields:
            return jsonify({
                "status": "error",
                "message": f"Missing fields: {', '.join(missing_fields)}"
            }), 400

        chit = {
            "id": str(data.get("id", datetime.now().timestamp())),
            "personName": str(data["personName"]).strip(),
            "chitAmount": float(data["chitAmount"]),
            "payments": [],
            "notes": data.get("notes", ""),
            "createdAt": datetime.now().isoformat()
        }
        if chit["chitAmount"] <= 0:
            return jsonify({"status": "error", "message": "Enter a positive chit amount"}), 400

        chits.append(chit)
        save_chits()
        return jsonify({"status": "success", "chit": chit}), 201
    except (TypeError, ValueError, KeyError) as error:
        return jsonify({"status": "error", "message": str(error)}), 400


@app.route("/get_chits", methods=["GET"])
def get_chits():
    return jsonify(chits)


@app.route("/record_chit_payment/<chit_id>", methods=["POST"])
def record_chit_payment(chit_id):
    try:
        data = request.get_json() or {}
        amount = float(data.get("amount", 0))
        payment_date = data.get("date", "")
        payment_note = str(data.get("note", "")).strip()
        if amount <= 0 or not payment_date:
            return jsonify({"status": "error", "message": "A positive amount and date are required"}), 400

        chit = next((item for item in chits if str(item.get("id")) == str(chit_id)), None)
        if not chit:
            return jsonify({"status": "error", "message": "Chit not found"}), 404

        chit.setdefault("payments", []).append({
            "date": payment_date,
            "amount": amount,
            "note": payment_note
        })
        save_chits()
        return jsonify({"status": "success", "chit": chit}), 200
    except (TypeError, ValueError) as error:
        return jsonify({"status": "error", "message": str(error)}), 400


@app.route("/delete_chit/<chit_id>", methods=["DELETE"])
def delete_chit(chit_id):
    try:
        original_count = len(chits)
        chits[:] = [chit for chit in chits if str(chit.get("id")) != str(chit_id)]
        if len(chits) == original_count:
            return jsonify({"status": "error", "message": "Chit not found"}), 404
        save_chits()
        return jsonify({"status": "success"}), 200
    except Exception as error:
        return jsonify({"status": "error", "message": str(error)}), 400

@app.route("/close_chit/<chit_id>", methods=["POST"])
def close_chit(chit_id):
    try:
        chit = next((item for item in chits if str(item.get("id")) == str(chit_id)), None)
        if not chit:
            return jsonify({"status": "error", "message": "Chit not found"}), 404
        chit["status"] = "closed"
        chit["closedAt"] = datetime.now().isoformat()
        save_chits()
        return jsonify({"status": "success", "chit": chit}), 200
    except Exception as error:
        return jsonify({"status": "error", "message": str(error)}), 400

@app.route("/reopen_chit/<chit_id>", methods=["POST"])
def reopen_chit(chit_id):
    try:
        chit = next((item for item in chits if str(item.get("id")) == str(chit_id)), None)
        if not chit:
            return jsonify({"status": "error", "message": "Chit not found"}), 404
        chit["status"] = "active"
        chit.pop("closedAt", None)
        save_chits()
        return jsonify({"status": "success", "chit": chit}), 200
    except Exception as error:
        return jsonify({"status": "error", "message": str(error)}), 400

# ============ ANALYTICS ENDPOINTS ============

@app.route("/get_analytics", methods=["GET"])
def get_analytics():
    try:
        total_lent = sum(l.get('principalAmount', 0) for l in lendings)
        total_received = sum(l.get('received', 0) for l in lendings)
        total_outstanding = sum(l.get('returnAmount', 0) - l.get('received', 0) for l in lendings)
        total_interest = sum(l.get('interestAmount', 0) for l in lendings)

        # Count by type
        weekly_count = len([l for l in lendings if l.get('type') == 'weekly'])
        daily_count = len([l for l in lendings if l.get('type') == 'daily'])
        monthly_count = len([l for l in lendings if l.get('type') == 'monthly'])

        # Pending collections
        today = datetime.now().date()
        next_week = today + timedelta(days=7)
        pending = []

        for lending in lendings:
            if lending.get('status') == 'active' and 'schedule' in lending:
                for item in lending['schedule']:
                    if not item.get('received'):
                        due_date = datetime.strptime(item['dueDate'], '%Y-%m-%d').date()
                        if today <= due_date <= next_week:
                            pending.append({
                                'person': lending.get('name'),
                                'amount': item.get('amount'),
                                'dueDate': item['dueDate'],
                                'lendingType': lending.get('type')
                            })

        return jsonify({
            "totalLent": total_lent,
            "totalReceived": total_received,
            "totalOutstanding": total_outstanding,
            "totalInterest": total_interest,
            "activeLendings": len([l for l in lendings if l.get('status') == 'active']),
            "completedLendings": len([l for l in lendings if l.get('status') == 'completed']),
            "byType": {
                "weekly": weekly_count,
                "daily": daily_count,
                "monthly": monthly_count
            },
            "pendingCollections": pending
        }), 200
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400

if __name__ == "__main__":
    # debug=False (no auto-reloader) avoids spawning a child process,
    # which prevents "Address already in use" errors inside the container.
    debug_mode = os.environ.get("FLASK_DEBUG", "0") == "1"
    app.run(host="0.0.0.0", port=5000, debug=debug_mode)
