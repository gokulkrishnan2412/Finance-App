from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import json
import os
from datetime import datetime, timedelta

app = Flask(__name__)
CORS(app)  # Enable CORS for frontend requests

# Keep the simple list API, but persist it so a Flask restart does not erase data.
DATA_FILE = os.path.join(os.path.dirname(__file__), "lendings.json")


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

@app.route("/clear_all", methods=["POST"])
def clear_all():
    try:
        global lendings
        lendings = []
        save_lendings()
        return jsonify({"status": "success"}), 200
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400

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
    app.run(host="0.0.0.0", port=5000, debug=True)
