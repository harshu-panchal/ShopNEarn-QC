import { Navigate } from "react-router-dom";

/** Legacy alias — Home Shoppy lives at `/mlm/franchise` inside MlmLayout. */
const MlmHomeShoppingPage = () => <Navigate to="/mlm/franchise" replace />;

export default MlmHomeShoppingPage;
