export type ShopifyReview = {key:string;stage:'prepare'|'decision'|'execute'|'reconcile'|'retry';action:'draft'|'publish';serviceId:string;revision:number;previewHash:string;operationId?:string;scopeHash?:string;publicationId?:string;title:string;detail:string;hasImages:boolean;allowConfirm:boolean};
const identities=new WeakMap<object,string>();
Component({
 options:{styleIsolation:'shared'},
 properties:{review:{type:Object,value:null,observer(raw:WechatMiniprogram.IAnyObject){const value=raw as ShopifyReview|null;if(!value){identities.delete(this);this.setData({target:null,checked:[],draftChecked:false,imagesChecked:false,publishChecked:false,executeChecked:false,readChecked:false,ready:false,error:''});return;}
   if(identities.get(this)!==value.key){identities.set(this,value.key);this.setData({checked:[],draftChecked:false,imagesChecked:false,publishChecked:false,executeChecked:false,readChecked:false,ready:false,error:''});}this.setData({target:value});}},busy:{type:Boolean,value:false},uncertain:{type:Boolean,value:false},serverError:{type:String,value:''}},
 data:{target:null as ShopifyReview|null,checked:[] as string[],draftChecked:false,imagesChecked:false,publishChecked:false,executeChecked:false,readChecked:false,ready:false,error:''},
 methods:{
  consent(event:WechatMiniprogram.CheckboxGroupChange){if(this.data.busy||this.data.uncertain)return;const checked=event.detail.value,t=this.data.target,ready=!!t&&t.allowConfirm&&(t.stage==='prepare'||t.stage==='decision'?t.action==='draft'?checked.includes('draft')&&(!t.hasImages||checked.includes('images')):checked.includes('publish'):t.stage==='reconcile'?checked.includes('read'):checked.includes('execute'));this.setData({checked,ready,draftChecked:checked.includes('draft'),imagesChecked:checked.includes('images'),publishChecked:checked.includes('publish'),executeChecked:checked.includes('execute'),readChecked:checked.includes('read'),error:''});},
  confirm(){const t=this.data.target;if(!t||this.data.busy||this.data.uncertain||!t.allowConfirm)return;
   const content=t.stage==='prepare'||t.stage==='decision',valid=content?t.action==='draft'?this.data.draftChecked&&(!t.hasImages||this.data.imagesChecked):this.data.publishChecked:t.stage==='reconcile'?this.data.readChecked:this.data.executeChecked;
   if(!valid){this.setData({error:'请分别明确确认本次准确操作和图片传输范围。'});return;}this.triggerEvent('confirm',{...t,confirmed:true});
  },
  deny(){const t=this.data.target;if(t?.stage==='decision'&&!this.data.busy&&!this.data.uncertain)this.triggerEvent('deny',{...t,confirmed:true});},
  close(){if(!this.data.busy){identities.delete(this);this.setData({checked:[]});this.triggerEvent('close');}},
 }
});
