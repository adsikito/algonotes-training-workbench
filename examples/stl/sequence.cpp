#include <iostream>
#include <vector>
#include <algorithm>
bool even(int x){return x%2==0;}bool odd(int x){return x%2!=0;}int square(int x){return x*x;}
void print(const std::vector<int>& v){for(std::size_t i=0;i<v.size();++i)std::cout<<(i?" ":"")<<v[i];std::cout<<'\n';}
int main(){
 std::vector<int> v{1,2,3,4};std::rotate(v.begin(),v.begin()+1,v.end());print(v);
 std::vector<int>::iterator mid=std::stable_partition(v.begin(),v.end(),even);print(v);std::cout<<(mid-v.begin())<<'\n';
 std::vector<int> out(v.size());std::transform(v.begin(),v.end(),out.begin(),square);print(out);
 v.erase(std::remove_if(v.begin(),v.end(),odd),v.end());print(v);
 int a[]={1,2,3},b[]={1,4,3};std::pair<int*,int*> p=std::mismatch(a,a+3,b);
 std::cout<<(p.first-a)<<' '<<std::lexicographical_compare(a,a+3,b,b+3)<<'\n';
}
