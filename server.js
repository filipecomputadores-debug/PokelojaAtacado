import express from "express";
import session from "express-session";
import bcrypt from "bcryptjs";
import Database from "better-sqlite3";
import dotenv from "dotenv";

dotenv.config();
const app=express();
const db=new Database("pokeloja.db");
const PORT=process.env.PORT||3000;
const MIN_ORDER=2500;
const FREIGHT_MARKUP=1.10;

app.use(express.json());
app.use(express.urlencoded({extended:true}));
app.use(session({
  secret:process.env.SESSION_SECRET||"change-me",
  resave:false,saveUninitialized:false,
  cookie:{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",maxAge:1000*60*60*8}
}));
app.use(express.static("public"));

db.exec(`
CREATE TABLE IF NOT EXISTS users(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL, doc TEXT, phone TEXT, email TEXT UNIQUE NOT NULL,
 cep TEXT, password TEXT NOT NULL, status TEXT DEFAULT 'pending',
 created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS products(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL, sku TEXT UNIQUE, price REAL NOT NULL,
 stock INTEGER NOT NULL DEFAULT 0, image TEXT, active INTEGER DEFAULT 1,
 weight REAL DEFAULT 0.2, width REAL DEFAULT 10, height REAL DEFAULT 10, length REAL DEFAULT 10,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS orders(
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
 subtotal REAL NOT NULL, freight_customer REAL NOT NULL, freight_internal REAL NOT NULL,
 total REAL NOT NULL, freight_service TEXT, destination_cep TEXT,
 status TEXT DEFAULT 'Recebido', created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS order_items(
 id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER, product_id INTEGER,
 qty INTEGER, unit_price REAL, FOREIGN KEY(order_id) REFERENCES orders(id)
);
`);

const adminEmail=(process.env.ADMIN_EMAIL||"admin@pokeloja.com.br").toLowerCase();
const adminPassword=process.env.ADMIN_PASSWORD||"troque-esta-senha";
const existingAdmin=db.prepare("SELECT id FROM users WHERE email=?").get(adminEmail);
if(!existingAdmin){
  db.prepare("INSERT INTO users(name,email,password,status) VALUES(?,?,?,'admin')")
    .run("Administrador",adminEmail,bcrypt.hashSync(adminPassword,12));
}
if(db.prepare("SELECT COUNT(*) c FROM products").get().c===0){
 const ins=db.prepare(`INSERT INTO products(name,sku,price,stock,image,weight,width,height,length) VALUES(?,?,?,?,?,?,?,?,?)`);
 [
  ["Booster Pokémon","PK-0001",19.90,120,"",0.03,7,2,12],
  ["Box Pokémon","PK-0002",349.90,25,"",0.80,20,8,15],
  ["Sleeves Pokémon","PK-0003",39.90,80,"",0.10,8,3,12],
  ["Deck Box","PK-0004",49.90,45,"",0.15,8,4,12],
  ["Elite Trainer Box","PK-0005",299.90,18,"",0.70,18,8,15],
  ["Lote de Cartas","PK-0006",99.90,60,"",0.30,12,5,18]
 ].forEach(x=>ins.run(...x));
}

const auth=(req,res,next)=>{if(!req.session.user)return res.status(401).json({error:"Não autenticado"});next()};
const admin=(req,res,next)=>{if(req.session.user?.status!=="admin")return res.status(403).json({error:"Acesso negado"});next()};

app.post("/api/register",(req,res)=>{
 const {name,doc,phone,email,cep,password}=req.body;
 if(!name||!email||!password)return res.status(400).json({error:"Preencha nome, e-mail e senha."});
 try{
  const hash=bcrypt.hashSync(password,12);
  db.prepare("INSERT INTO users(name,doc,phone,email,cep,password) VALUES(?,?,?,?,?,?)")
    .run(name,doc||"",phone||"",email.toLowerCase(),cep||"",hash);
  res.json({ok:true});
 }catch(e){res.status(400).json({error:"E-mail já cadastrado."})}
});

app.post("/api/login",(req,res)=>{
 const u=db.prepare("SELECT * FROM users WHERE email=?").get((req.body.email||"").toLowerCase());
 if(!u||!bcrypt.compareSync(req.body.password||"",u.password))return res.status(401).json({error:"E-mail ou senha inválidos."});
 if(u.status==="pending")return res.status(403).json({error:"Cadastro aguardando aprovação."});
 if(u.status==="blocked")return res.status(403).json({error:"Cadastro bloqueado."});
 req.session.user={id:u.id,name:u.name,email:u.email,status:u.status};
 res.json({user:req.session.user});
});
app.post("/api/logout",(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get("/api/me",auth,(req,res)=>res.json(req.session.user));

app.get("/api/products",auth,(req,res)=>{
 res.json(db.prepare("SELECT id,name,sku,price,stock,image FROM products WHERE active=1 ORDER BY name").all());
});

app.post("/api/shipping/calculate",auth,(req,res)=>{
 // Integração real: este endpoint deve chamar o Melhor Envio no servidor.
 // O cliente recebe SOMENTE o valor final de cobrança.
 const {cep,items}=req.body;
 if(!cep||!items?.length)return res.status(400).json({error:"CEP e itens são obrigatórios."});
 // Placeholder seguro enquanto as credenciais do Melhor Envio não estiverem configuradas.
 const base=29.90;
 const options=[
  {service:"PAC",price:Number((base*FREIGHT_MARKUP).toFixed(2)),days:"5 a 9 dias úteis"},
  {service:"SEDEX",price:Number((base*1.65*FREIGHT_MARKUP).toFixed(2)),days:"2 a 5 dias úteis"},
  {service:"Transportadora",price:Number((base*1.25*FREIGHT_MARKUP).toFixed(2)),days:"4 a 8 dias úteis"}
 ];
 res.json({options});
});

app.post("/api/orders",auth,(req,res)=>{
 const {items,cep,freight}=req.body;
 if(!items?.length)return res.status(400).json({error:"Carrinho vazio."});
 const ids=items.map(i=>Number(i.productId));
 const products=db.prepare(`SELECT * FROM products WHERE id IN (${ids.map(()=>"?").join(",")})`).all(...ids);
 let subtotal=0;
 const normalized=[];
 for(const i of items){
  const p=products.find(x=>x.id===Number(i.productId));
  const qty=Number(i.qty);
  if(!p||qty<1||qty>p.stock)return res.status(400).json({error:`Estoque insuficiente para ${p?.name||"produto"}.`});
  subtotal+=p.price*qty; normalized.push({p,qty});
 }
 if(subtotal<MIN_ORDER)return res.status(400).json({error:"O pedido mínimo é de R$ 2.500,00."});
 const customerFreight=Number(freight?.price||0);
 if(customerFreight<=0)return res.status(400).json({error:"Selecione um frete."});
 // Importante: freight_internal é o custo/base para controle interno.
 // freight_customer é o valor já ajustado que o cliente vê. Nenhuma margem é exibida.
 const internalFreight=Number((customerFreight/FREIGHT_MARKUP).toFixed(2));
 const total=Number((subtotal+customerFreight).toFixed(2));
 const tx=db.transaction(()=>{
  const order=db.prepare(`INSERT INTO orders(user_id,subtotal,freight_customer,freight_internal,total,freight_service,destination_cep)
   VALUES(?,?,?,?,?,?,?)`).run(req.session.user.id,subtotal,customerFreight,internalFreight,total,freight.service,cep);
  const oi=db.prepare("INSERT INTO order_items(order_id,product_id,qty,unit_price) VALUES(?,?,?,?)");
  const up=db.prepare("UPDATE products SET stock=stock-? WHERE id=?");
  normalized.forEach(x=>{oi.run(order.lastInsertRowid,x.p.id,x.qty,x.p.price);up.run(x.qty,x.p.id)});
  return order.lastInsertRowid;
 });
 const id=tx();
 res.json({ok:true,orderId:id});
});

app.get("/api/orders",auth,(req,res)=>{
 const orders=db.prepare("SELECT * FROM orders WHERE user_id=? ORDER BY id DESC").all(req.session.user.id);
 const getItems=db.prepare(`SELECT oi.*,p.name FROM order_items oi JOIN products p ON p.id=oi.product_id WHERE order_id=?`);
 res.json(orders.map(o=>({...o,items:getItems.all(o.id)})));
});

app.get("/api/admin/users",admin,(req,res)=>res.json(db.prepare("SELECT id,name,doc,phone,email,cep,status,created_at FROM users ORDER BY id DESC").all()));
app.post("/api/admin/users/:id/approve",admin,(req,res)=>{db.prepare("UPDATE users SET status='approved' WHERE id=?").run(req.params.id);res.json({ok:true})});
app.post("/api/admin/users/:id/block",admin,(req,res)=>{db.prepare("UPDATE users SET status='blocked' WHERE id=?").run(req.params.id);res.json({ok:true})});
app.get("/api/admin/orders",admin,(req,res)=>{
 const rows=db.prepare(`SELECT o.*,u.name,u.email FROM orders o JOIN users u ON u.id=o.user_id ORDER BY o.id DESC`).all();
 res.json(rows);
});
app.get("/api/admin/products",admin,(req,res)=>res.json(db.prepare("SELECT * FROM products ORDER BY id DESC").all()));
app.post("/api/admin/products",admin,(req,res)=>{
 const {name,sku,price,stock,image,weight,width,height,length}=req.body;
 try{
  const r=db.prepare(`INSERT INTO products(name,sku,price,stock,image,weight,width,height,length) VALUES(?,?,?,?,?,?,?,?,?)`)
   .run(name,sku,price,stock,image||"",weight||.2,width||10,height||10,length||10);
  res.json({id:r.lastInsertRowid});
 }catch(e){res.status(400).json({error:e.message})}
});
app.put("/api/admin/products/:id",admin,(req,res)=>{
 const {name,price,stock,image,active}=req.body;
 db.prepare("UPDATE products SET name=?,price=?,stock=?,image=?,active=? WHERE id=?").run(name,price,stock,image||"",active?1:0,req.params.id);
 res.json({ok:true});
});

app.listen(PORT,()=>console.log(`Pokeloja Atacado rodando em http://localhost:${PORT}`));
