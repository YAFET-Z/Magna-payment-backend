import express from 'express';
import { PrismaClient } from '@prisma/client';
import cors from 'cors';
import { v2 as cloudinary } from 'cloudinary';

const app = express();
const prisma = new PrismaClient();

cloudinary.config({
  cloud_name: 'hrtniqhj',
  api_key: '416163757445766',
  api_secret: 'trmYUVck_qi6LnILHa_19R_h4iI'
});

app.use(cors());
app.use(express.json({ limit: '20mb' })); 

// 1. AUTH & USER MANAGEMENT
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || user.password !== password) return res.status(401).json({ error: 'Invalid credentials' });
    res.json({ id: user.id, fullName: user.fullName, role: user.role, requiresSetup: user.requiresSetup });
  } catch (error) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/users/register', async (req, res) => {
  try {
    const { email, password, fullName, role, dailyWage } = req.body;
    const existing = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    if (existing) return res.status(400).json({ error: 'Email exists.' });
    const user = await prisma.user.create({
      data: { email: email.trim().toLowerCase(), password, fullName, role, requiresSetup: true, dailyWage: parseFloat(dailyWage || '0') }
    });
    res.json({ message: 'User registered', id: user.id });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.put('/api/users/setup/:id', async (req, res) => {
  try {
    const { password, bankAccount, telebirr } = req.body;
    await prisma.user.update({ where: { id: req.params.id }, data: { password, bankAccount, telebirr, requiresSetup: false } });
    res.json({ message: 'Setup complete.' });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// 2. EVENTS (TIME TRACKING)
app.post('/api/events/start', async (req, res) => {
  try {
    const { workerId, eventName, workerRole } = req.body;
    const active = await prisma.event.findFirst({ where: { workerId, status: 'ONGOING' } });
    if (active) return res.status(400).json({ error: 'You must stop your current event before starting a new one.' });
    const event = await prisma.event.create({ data: { workerId, eventName, workerRole, status: 'ONGOING' } });
    res.json(event);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.put('/api/events/stop/:id', async (req, res) => {
  try {
    const event = await prisma.event.findUnique({ where: { id: req.params.id } });
    if (!event) return res.status(404).json({ error: 'Event not found' });
    const endDate = new Date();
    const diffTime = Math.abs(endDate.getTime() - event.startDate.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
    const updated = await prisma.event.update({ where: { id: req.params.id }, data: { status: 'COMPLETED', endDate, totalDaysWorked: diffDays === 0 ? 1 : diffDays } });
    res.json(updated);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.post('/api/events/prior', async (req, res) => {
  try {
    const { workerId, eventName, workerRole, startDate, endDate, mealAmount, mealReceiptBase64, rideAmount, rideReceiptBase64 } = req.body;
    const start = new Date(startDate); const end = new Date(endDate);
    const diffTime = Math.abs(end.getTime() - start.getTime());
    const totalDaysWorked = Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
    const event = await prisma.event.create({ data: { workerId, eventName, workerRole, startDate: start, endDate: end, status: 'COMPLETED', wageStatus: 'PENDING', totalDaysWorked } });
    
    let totalExpenseAmount = 0;
    if (mealAmount) {
      let receiptUrl = 'no-image-uploaded';
      if (mealReceiptBase64) { const uploadRes = await cloudinary.uploader.upload(`data:image/jpeg;base64,${mealReceiptBase64}`, { folder: 'magna_receipts' }); receiptUrl = uploadRes.secure_url; }
      await prisma.expense.create({ data: { eventId: event.id, workerId, amount: parseFloat(mealAmount), expenseType: 'MEAL', receiptImageUrl: receiptUrl } });
      totalExpenseAmount += parseFloat(mealAmount);
    }
    if (rideAmount) {
      let receiptUrl = 'no-image-uploaded';
      if (rideReceiptBase64) { const uploadRes = await cloudinary.uploader.upload(`data:image/jpeg;base64,${rideReceiptBase64}`, { folder: 'magna_receipts' }); receiptUrl = uploadRes.secure_url; }
      await prisma.expense.create({ data: { eventId: event.id, workerId, amount: parseFloat(rideAmount), expenseType: 'RIDE', receiptImageUrl: receiptUrl } });
      totalExpenseAmount += parseFloat(rideAmount);
    }
    if (totalExpenseAmount > 0) await prisma.user.update({ where: { id: workerId }, data: { totalPendingBalance: { increment: totalExpenseAmount } } });
    res.json(event);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// 3. EXPENSES & DASHBOARD
app.post('/api/expenses', async (req, res) => {
  try {
    const { eventId, workerId, amount, expenseType, receiptImageBase64 } = req.body;
    let receiptImageUrl = 'no-image-uploaded';
    if (receiptImageBase64) { const uploadRes = await cloudinary.uploader.upload(`data:image/jpeg;base64,${receiptImageBase64}`, { folder: 'magna_receipts' }); receiptImageUrl = uploadRes.secure_url; }
    const expense = await prisma.expense.create({ data: { eventId, workerId, amount, expenseType, receiptImageUrl } });
    await prisma.user.update({ where: { id: workerId }, data: { totalPendingBalance: { increment: amount } } });
    res.json(expense);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.get('/api/expenses/worker/:id', async (req, res) => {
  try {
    const worker = await prisma.user.findUnique({ where: { id: req.params.id } });
    const expenses = await prisma.expense.findMany({ where: { workerId: req.params.id }, orderBy: { createdAt: 'desc' }, include: { event: true } });
    res.json({ expenses, bankAccount: worker?.bankAccount, telebirr: worker?.telebirr });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.get('/api/worker/dashboard/:id', async (req, res) => {
  try {
    const worker = await prisma.user.findUnique({ where: { id: req.params.id } });
    const activeEvent = await prisma.event.findFirst({ where: { workerId: req.params.id, status: 'ONGOING' }, include: { expenses: { orderBy: { createdAt: 'desc' } } } });
    const completedEvents = await prisma.event.findMany({ where: { workerId: req.params.id, status: 'COMPLETED' }, orderBy: { endDate: 'desc' }, include: { expenses: true } });
    const settledExpenses = await prisma.expense.findMany({ where: { workerId: req.params.id, status: 'SETTLED' }, orderBy: { createdAt: 'desc' }, include: { event: true } });
    res.json({ worker, activeEvent, completedEvents, settledExpenses, totalUnowedBalance: worker?.totalPendingBalance || 0 });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// 4. MANAGER FINANCE (3-TAB SYSTEM)
app.get('/api/finance/company-pending-expenses', async (req, res) => {
  try {
    const pendingUsers = await prisma.user.findMany({
      where: { totalPendingBalance: { gt: 0 } },
      include: { expenses: { where: { status: 'PENDING' }, orderBy: { createdAt: 'desc' }, include: { event: true } } }
    });
    const totalCompanyPending = pendingUsers.reduce((sum, user) => sum + user.totalPendingBalance, 0);
    res.json({ totalCompanyPending, actionNeeded: pendingUsers });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.get('/api/finance/company-pending-wages', async (req, res) => {
  try {
    const workers = await prisma.user.findMany({
      where: { events: { some: { status: 'COMPLETED', wageStatus: 'PENDING' } } },
      include: { events: { where: { status: 'COMPLETED', wageStatus: 'PENDING' }, orderBy: { endDate: 'desc' } } }
    });
    res.json(workers);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.get('/api/finance/all-workers', async (req, res) => {
  try {
    const workers = await prisma.user.findMany({ where: { role: 'WORKER' }, orderBy: { fullName: 'asc' } });
    res.json(workers);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.put('/api/expenses/settle/:workerId', async (req, res) => {
  try {
    const { settlementReceiptBase64 } = req.body;
    let settlementReceiptUrl = null;
    if (settlementReceiptBase64) { const uploadRes = await cloudinary.uploader.upload(`data:image/jpeg;base64,${settlementReceiptBase64}`, { folder: 'magna_settlements' }); settlementReceiptUrl = uploadRes.secure_url; }
    await prisma.expense.updateMany({ where: { workerId: req.params.workerId, status: 'PENDING' }, data: { status: 'SETTLED', settlementReceiptUrl } });
    await prisma.user.update({ where: { id: req.params.workerId }, data: { totalPendingBalance: 0 } });
    res.json({ message: 'Expenses settled.' });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// SINGLE EVENT WAGE SETTLEMENT
app.put('/api/finance/settle-wage/:eventId', async (req, res) => {
  try {
    const { wageSettlementBase64 } = req.body;
    let wageSettlementReceipt = null;
    if (wageSettlementBase64) { const uploadRes = await cloudinary.uploader.upload(`data:image/jpeg;base64,${wageSettlementBase64}`, { folder: 'magna_wages' }); wageSettlementReceipt = uploadRes.secure_url; }
    await prisma.event.update({ where: { id: req.params.eventId }, data: { wageStatus: 'SETTLED', wageSettlementReceipt } });
    res.json({ message: 'Wages settled.' });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// NEW: BULK WAGE SETTLEMENT BY SELECTED EVENTS
app.put('/api/finance/settle-wages-bulk', async (req, res) => {
  try {
    const { eventIds, wageSettlementBase64 } = req.body;
    if (!eventIds || !Array.isArray(eventIds) || eventIds.length === 0) return res.status(400).json({ error: 'No events selected' });
    
    let wageSettlementReceipt = null;
    if (wageSettlementBase64) { 
      const uploadRes = await cloudinary.uploader.upload(`data:image/jpeg;base64,${wageSettlementBase64}`, { folder: 'magna_wages' }); 
      wageSettlementReceipt = uploadRes.secure_url; 
    }
    
    await prisma.event.updateMany({ 
      where: { id: { in: eventIds } }, 
      data: { wageStatus: 'SETTLED', wageSettlementReceipt } 
    });
    res.json({ message: 'Selected wages settled successfully.' });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});


// 5. EDIT & DELETE LOGS
app.put('/api/expenses/:id', async (req, res) => {
  try {
    const { amount } = req.body;
    const expense = await prisma.expense.findUnique({ where: { id: req.params.id } });
    if (!expense || expense.status === 'SETTLED') return res.status(400).json({ error: 'Cannot edit settled expense' });
    const numAmount = parseFloat(amount);
    if (numAmount !== expense.amount) await prisma.user.update({ where: { id: expense.workerId }, data: { totalPendingBalance: { increment: numAmount - expense.amount } } });
    const updated = await prisma.expense.update({ where: { id: req.params.id }, data: { amount: numAmount } });
    res.json(updated);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/expenses/:id', async (req, res) => {
  try {
    const expense = await prisma.expense.findUnique({ where: { id: req.params.id } });
    if (!expense || expense.status === 'SETTLED') return res.status(400).json({ error: 'Cannot delete settled expense' });
    await prisma.user.update({ where: { id: expense.workerId }, data: { totalPendingBalance: { decrement: expense.amount } } });
    await prisma.expense.delete({ where: { id: req.params.id } });
    res.json({ message: 'Deleted' });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.put('/api/events/:id', async (req, res) => {
  try {
    const { eventName, workerRole } = req.body;
    const updated = await prisma.event.update({ where: { id: req.params.id }, data: { eventName, workerRole } });
    res.json(updated);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/events/:id', async (req, res) => {
  try {
    const event = await prisma.event.findUnique({ where: { id: req.params.id }, include: { expenses: true } });
    if (!event || event.wageStatus === 'SETTLED') return res.status(400).json({ error: 'Cannot delete settled event' });
    const amountToDecrement = event.expenses.filter(e => e.status === 'PENDING').reduce((sum, e) => sum + e.amount, 0);
    if (amountToDecrement > 0) await prisma.user.update({ where: { id: event.workerId }, data: { totalPendingBalance: { decrement: amountToDecrement } } });
    await prisma.expense.deleteMany({ where: { eventId: req.params.id } });
    await prisma.event.delete({ where: { id: req.params.id } });
    res.json({ message: 'Deleted' });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.listen(3000, '0.0.0.0', () => console.log('Field Payments API running on port 3000'));