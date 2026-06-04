const fs = require('fs');
const oldAttributes = {
  "localHash": "drift_detected",
  "remoteId": "CA-HT360:50",
  "issueNumber": 50,
  "title": "20260604_162734_1f0aba.run",
  "body": "### Test Cases\n- [ ] #44\n- [ ] #42\n- [ ] #46\n- [ ] #43\n- [ ] #45\n- [ ] #40\n- [ ] #47\n- [ ] #41",
  "labels": [
    "testrun"
  ],
  "assignees": [
    "fromeroc9"
  ],
  "milestone": "",
  "custom_fields": {
    "Status": "Todo",
    "module": "Maestros",
    "quarter": "Q1",
    "sprint": "Sprint 2",
    "project": "Hirent Talent 360",
    "priority": "@medium"
  }
};
const newPayload = {
  "title": "20260604_162734_1f0aba.run",
  "body": "### Test Cases\n- [ ] #44\n- [ ] #42\n- [ ] #46\n- [ ] #43\n- [ ] #45\n- [ ] #40\n- [ ] #47\n- [ ] #41",
  "labels": [
    "testrun"
  ],
  "assignees": [
    "fromeroc9"
  ],
  "milestone": "",
  "custom_fields": {
    "Status": "Todo",
    "module": "Maestros",
    "quarter": "Q1",
    "sprint": "Sprint 2",
    "startDate": "",
    "endDate": ""
  }
};
const keys = Object.keys(newPayload);
for (const key of keys) {
    const newVal = newPayload[key];
    const oldVal = oldAttributes[key];
    if (JSON.stringify(newVal) !== JSON.stringify(oldVal)) {
        console.log(`Difference in ${key}:`);
        console.log(`old: ${JSON.stringify(oldVal)}`);
        console.log(`new: ${JSON.stringify(newVal)}`);
    }
}
